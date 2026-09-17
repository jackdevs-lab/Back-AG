import {
    BrandedRepository,
    BrandedSyncStatus,
    PrismaBrandedRepository,
    RealmId,
    prisma,
} from '@qb-health/financial-model';
import { QbApiClient } from '@qb-health/qb-client';
import { createLogger } from '@qb-health/utils';
import { BatchUpsertService } from './batch-upsert.service';
import { Mapper, TenantId } from './mapper';
import { SupportedEntityType, SyncResult } from './sync-types';

export class SyncEngine {
    private realmId: RealmId;
    private qbClient: QbApiClient;
    private tenantId: TenantId;
    private connectionId?: string;
    private logger: any;
    private mapper: Mapper;
    private batchService: BatchUpsertService;
    private repo: BrandedRepository;

    constructor(
        realmId: RealmId,
        tenantId: string,
        qbClient: QbApiClient,
        connectionId?: string,
        mapper = new Mapper(),
        batchService = new BatchUpsertService(),
        repo: BrandedRepository = new PrismaBrandedRepository(prisma)
    ) {
        this.realmId = realmId;
        this.tenantId = tenantId as TenantId;
        this.connectionId = connectionId;
        this.qbClient = qbClient;
        this.logger = createLogger({ realmId, tenantId });
        this.mapper = mapper;
        this.batchService = batchService;
        this.repo = repo;
    }

    async runFullSync(): Promise<SyncResult[]> {
        const startTime = Date.now();
        const syncSessionStartTime = new Date();

        const allResults: SyncResult[] = [];

        // --- DELETIONS FIRST ---
        const entitiesForCdc = ['Account', 'Customer', 'Vendor', 'Invoice', 'Bill', 'Payment', 'Purchase', 'JournalEntry'];

        const connection = await prisma.qbConnection.findUnique({
            where: {
                tenantId_realmId: {
                    tenantId: String(this.tenantId),
                    realmId: String(this.realmId)
                }
            },
            select: { lastSyncAt: true },
        });

        const defaultCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const changedSince = connection?.lastSyncAt ? connection.lastSyncAt.toISOString() : defaultCutoff;

        const initialDeletionResult = await this.syncDeletions(entitiesForCdc, changedSince);
        allResults.push(initialDeletionResult);

        // --- NOW BASE ENTITIES ---

        this.logger.info('Starting full sync', { realmId: this.realmId, tenantId: this.tenantId });
        await this.repo.updateQbConnectionStatus(
            String(this.tenantId),
            this.realmId,
            'SYNCING' as BrandedSyncStatus
        );

        try {
            const baseEntities: Array<{ type: SupportedEntityType; sync: () => Promise<SyncResult> }> = [
                { type: 'Account', sync: () => this.syncAccounts(syncSessionStartTime) },
                { type: 'Customer', sync: () => this.syncCustomers(syncSessionStartTime) },
                { type: 'Vendor', sync: () => this.syncVendors(syncSessionStartTime) },
            ];

            const transactionalEntities: Array<{ type: SupportedEntityType; sync: () => Promise<SyncResult> }> = [
                { type: 'Invoice', sync: () => this.syncInvoices(syncSessionStartTime) },
                { type: 'Bill', sync: () => this.syncBills(syncSessionStartTime) },
                { type: 'Payment', sync: () => this.syncPayments(syncSessionStartTime) },
                { type: 'Purchase', sync: () => this.syncTransactionWithBankMapping('Purchase', syncSessionStartTime) },
                { type: 'JournalEntry', sync: () => this.syncTransactionWithBankMapping('JournalEntry', syncSessionStartTime) },
                { type: 'Deposit', sync: () => this.syncTransactionWithBankMapping('Deposit', syncSessionStartTime) },
                { type: 'Transfer', sync: () => this.syncTransactionWithBankMapping('Transfer', syncSessionStartTime) },
            ];

            // 1. Execute Base Entities (Stop execution on failure)
            for (const entity of baseEntities) {
                try {
                    allResults.push(await entity.sync());
                } catch (error) {
                    this.logger.error(`Failed base entity ${entity.type}`, error as Error, { realmId: this.realmId });
                    allResults.push(this.createFailedResult(entity.type, (error as Error).message));
                    throw new Error(`Base entity ${entity.type} failed. Aborting full sync.`);
                }
            }

            // 2. Execute Transactional Entities (Single pass for both Transaction and BankActivity)
            let partialFailure = false;

            for (const entity of transactionalEntities) {
                try {
                    allResults.push(await entity.sync());
                } catch (error) {
                    partialFailure = true;
                    this.logger.error(`Failed transactional entity ${entity.type}`, error as Error, { realmId: this.realmId });
                    allResults.push(this.createFailedResult(entity.type, (error as Error).message));
                }
            }

            // 3. CDC Lookback Window (30-day max Intuit limit)
            const thirtyDaysAgo = new Date(syncSessionStartTime.getTime() - 30 * 24 * 60 * 60 * 1000);
            const cdcTimestamp = thirtyDaysAgo.toISOString();

            const allEntityTypes: SupportedEntityType[] = [
                'Account', 'Customer', 'Vendor', 'Invoice', 'Bill',
                'Payment', 'Purchase', 'JournalEntry', 'Deposit', 'Transfer'
            ];

            // FIX: Filter out unsupported entities prior to assembling the CDC query
            const cdcSupportedEntityTypes = allEntityTypes.filter(
                entity => entity !== 'Deposit' && entity !== 'Transfer'
            );
            const lookbackDeletionResult = await this.syncDeletions(cdcSupportedEntityTypes, cdcTimestamp);
            allResults.push(lookbackDeletionResult);

            await this.repo.updateQbConnectionStatus(
                String(this.tenantId),
                this.realmId,
                // Optional: You could use `partialFailure` here if your status enum supports 'PARTIAL_SUCCESS'
                'IDLE' as BrandedSyncStatus,
                new Date()
            );

            this.logger.info('Full sync completed', {
                realmId: this.realmId,
                tenantId: this.tenantId,
                durationMs: Date.now() - startTime,
                entitiesProcessed: allResults.length,
                partialFailure
            });

            return allResults;
        } catch (error) {
            this.logger.error('Full sync failed during execution', error as Error, { realmId: this.realmId });
            await this.repo.updateQbConnectionStatus(
                String(this.tenantId),
                this.realmId,
                'ERROR' as BrandedSyncStatus,
                new Date()
            );
            throw error;
        }
    }

    /**
     * Paginates an entity fetch one page at a time and hands each page to processBatch.
     *
     * Pagination is owned HERE, not by QbApiClient. The client's query() is a
     * single-page primitive: it takes pageSize + startPosition and returns one page.
     *
     * Terminates when:
     *   - the server returns zero records, or
     *   - the server returns fewer than pageSize records (last page).
     *
     * A hard page ceiling guards against an infinite loop if the caller ever
     * mis-constructs a whereClause or the server misbehaves.
     */
    private async fetchAndProcessPaged(
        entity: string,
        whereClause: string,
        processBatch: (batch: any[]) => Promise<number>,
        pageSize = 500
    ): Promise<number> {
        let startPosition = 1;
        let totalProcessed = 0;
        let pageCount = 0;

        // 1000 pages × 500 = 500,000 records. If we ever exceed this, something is
        // wrong and we want a loud failure rather than a silent runaway loop.
        const MAX_PAGES = 1000;

        while (true) {
            const rawRecords = await this.qbClient.query<any>(
                entity,
                whereClause,
                pageSize,
                startPosition
            );

            const returned = rawRecords?.length ?? 0;

            this.logger.info('paged fetch', { entity, startPosition, returned });

            if (returned === 0) {
                break;
            }

            totalProcessed += await processBatch(rawRecords);

            if (returned < pageSize) {
                break;
            }

            startPosition += pageSize;

            if (++pageCount >= MAX_PAGES) {
                throw new Error(
                    `fetchAndProcessPaged exceeded ${MAX_PAGES} pages for ${entity} ` +
                    `at startPosition ${startPosition}. Aborting to prevent runaway loop.`
                );
            }
        }

        return totalProcessed;
    }

    private async syncDeletions(entities: string[], changedSince: string): Promise<SyncResult> {
        const startTime = Date.now();
        try {
            const cdcData = await this.qbClient.cdc(entities, changedSince);
            const cdcResponses = cdcData?.CDCResponse || [];
            const tenantIdStr = String(this.tenantId);
            const realmIdStr = String(this.realmId);
            const purgedQbIds: string[] = [];

            for (const response of cdcResponses) {
                for (const queryResp of response.QueryResponse || []) {
                    // Iterate over all keys in the query response (e.g., 'Customer', 'Invoice', 'Account')
                    for (const [entityType, entityList] of Object.entries(queryResp)) {
                        // Skip pagination/metadata fields that are not entity arrays
                        if (['startPosition', 'maxResults', 'totalCount'].includes(entityType)) {
                            continue;
                        }

                        if (!Array.isArray(entityList)) continue;

                        for (const item of entityList) {
                            if (!item) continue;

                            // QuickBooks indicates deletions in two ways:
                            // 1. Name list entities use `Active: false`
                            // 2. Transactions use `status: 'Deleted'`
                            const isDeleted = item.Active === false || item.status === 'Deleted';

                            // QuickBooks uses capital 'Id', not 'id'
                            if (!isDeleted || !item.Id) continue;

                            const qbId = String(item.Id);
                            purgedQbIds.push(qbId);

                            // Strict multi-tenant isolation on all delete operations
                            switch (entityType) {
                                case 'Account':
                                    await prisma.account.deleteMany({
                                        where: { tenantId: tenantIdStr, realmId: realmIdStr, qbId },
                                    });
                                    break;
                                case 'Customer':
                                    await prisma.customer.deleteMany({
                                        where: { tenantId: tenantIdStr, realmId: realmIdStr, qbId },
                                    });
                                    break;
                                case 'Vendor':
                                    await prisma.vendor.deleteMany({
                                        where: { tenantId: tenantIdStr, realmId: realmIdStr, qbId },
                                    });
                                    break;
                                default:
                                    // For transactions and other entities
                                    await prisma.transaction.deleteMany({
                                        where: { tenantId: tenantIdStr, realmId: realmIdStr, qbId },
                                    });
                                    await prisma.bankTransaction.deleteMany({
                                        where: { tenantId: tenantIdStr, realmId: realmIdStr, qbId },
                                    });
                                    break;
                            }
                        }
                    }
                }
            }

            if (purgedQbIds.length > 0) {
                await this.autoResolveDeletedIssues(purgedQbIds);
            }

            return this.createSuccessResult('Deletions', purgedQbIds.length, Date.now() - startTime);
        } catch (error) {
            this.logger.error('CDC Deletion check failed', error as Error);
            return this.createFailedResult('Deletions', (error as Error).message);
        }
    }

    private async autoResolveDeletedIssues(deletedQbIds: string[]): Promise<void> {
        const whereCondition = this.connectionId
            ? { connectionId: String(this.connectionId), isResolved: false }
            : { tenantId: String(this.tenantId), realmId: String(this.realmId), isResolved: false };

        const openIssues = await prisma.issue.findMany({
            where: whereCondition,
            select: { id: true, entities: true },
        });

        // Optimize lookup using a Set for O(1) performance instead of O(N) array.includes
        const deletedQbIdSet = new Set(deletedQbIds.map(id => String(id)));

        const issueIdsToResolve = openIssues
            .filter((issue) => {
                const entityList = (issue.entities as Array<{ id: string }>) || [];
                return entityList.some((e) => deletedQbIdSet.has(String(e.id)));
            })
            .map((issue) => issue.id);

        if (issueIdsToResolve.length > 0) {
            await prisma.issue.updateMany({
                where: { id: { in: issueIdsToResolve } },
                data: { isResolved: true, resolvedAt: new Date() },
            });

            this.logger.info(`Auto-resolved ${issueIdsToResolve.length} issues for deleted entities`, {
                realmId: this.realmId,
                tenantId: this.tenantId,
            });
        }
    }

    private async syncAccounts(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Account', 'WHERE Active = true', async (batch) => {
            const mapped = batch.map((a) => this.mapper.mapAccount(a, this.realmId, this.tenantId, syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Account', this.realmId);
        });
        return this.createSuccessResult('Account', count, Date.now() - startTime);
    }

    private async syncCustomers(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Customer', 'WHERE Active = true', async (batch) => {
            const mapped = batch.map((c) => this.mapper.mapCustomer(c, this.realmId, this.tenantId, syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Customer', this.realmId);
        });
        return this.createSuccessResult('Customer', count, Date.now() - startTime);
    }

    private async syncVendors(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Vendor', 'WHERE Active = true', async (batch) => {
            const mapped = batch.map((v) => this.mapper.mapVendor(v, this.realmId, this.tenantId, syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Vendor', this.realmId);
        });
        return this.createSuccessResult('Vendor', count, Date.now() - startTime);
    }

    private async syncInvoices(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Invoice', '', async (batch) => {
            const mapped = batch.map((i) => this.mapper.mapTransaction(i, this.realmId, this.tenantId, 'Invoice', syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });
        return this.createSuccessResult('Invoice', count, Date.now() - startTime);
    }

    private async syncBills(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Bill', '', async (batch) => {
            const mapped = batch.map((b) => this.mapper.mapTransaction(b, this.realmId, this.tenantId, 'Bill', syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });
        return this.createSuccessResult('Bill', count, Date.now() - startTime);
    }

    private async syncPayments(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Payment', '', async (batch) => {
            const mapped = batch.map((p) => this.mapper.mapTransaction(p, this.realmId, this.tenantId, 'Payment', syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });
        return this.createSuccessResult('Payment', count, Date.now() - startTime);
    }

    // Combined single-pass fetcher for Bank-related transactional entities
    // Combined single-pass fetcher for Bank-related transactional entities
    private async syncTransactionWithBankMapping(
        entityType: 'Purchase' | 'JournalEntry' | 'Deposit' | 'Transfer',
        syncStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged(entityType, '', async (batch) => {
            // 1. Map standard transaction records
            const txMapped = batch.map((item) =>
                this.mapper.mapTransaction(item, this.realmId, this.tenantId, entityType, syncStartTime)
            );

            // 2. Simultaneously map unified bank activity from same batch
            const bankMapped = batch
                .map((item) =>
                    this.mapper.mapToUnifiedBankTransaction(item, entityType, this.realmId, this.tenantId, syncStartTime)
                )
                .filter((m) => m !== null);

            // 3. Execute both upserts together inside a transaction block
            await prisma.$transaction(async (tx) => {
                await this.batchService.batchUpsertTx(tx, txMapped, 'Transaction', this.realmId);
                if (bankMapped.length > 0) {
                    await this.batchService.batchUpsertTx(tx, bankMapped, 'BankTransaction', this.realmId);
                }
            });

            return txMapped.length;
        });

        return this.createSuccessResult(entityType, count, Date.now() - startTime);
    }

    private createSuccessResult(entityType: string, recordsSynced: number, durationMs: number): SyncResult {
        return {
            realmId: this.realmId,
            entityType,
            recordsSynced,
            durationMs,
            status: 'SUCCESS',
        };
    }

    private createFailedResult(entityType: string, errorMessage: string): SyncResult {
        return {
            realmId: this.realmId,
            entityType,
            recordsSynced: 0,
            durationMs: 0,
            status: 'FAILED',
            errorMessage,
        };
    }
}