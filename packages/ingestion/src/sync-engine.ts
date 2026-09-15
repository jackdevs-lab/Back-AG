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

        this.logger.info('Starting full sync', { realmId: this.realmId, tenantId: this.tenantId });
        await this.repo.updateQbConnectionStatus(
            String(this.tenantId),
            this.realmId,
            'SYNCING' as BrandedSyncStatus
        );

        try {
            const allResults: SyncResult[] = [];

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
            for (const entity of transactionalEntities) {
                try {
                    allResults.push(await entity.sync());
                } catch (error) {
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
            await this.syncDeletions(allEntityTypes, cdcTimestamp);

            await this.repo.updateQbConnectionStatus(
                String(this.tenantId),
                this.realmId,
                'IDLE' as BrandedSyncStatus,
                new Date()
            );

            this.logger.info('Full sync completed successfully', {
                realmId: this.realmId,
                tenantId: this.tenantId,
                durationMs: Date.now() - startTime,
                entitiesProcessed: allResults.length,
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

    private async fetchAndProcessPaged(
        entity: string,
        whereClause: string,
        processBatch: (batch: any[]) => Promise<number>,
        pageSize = 500
    ): Promise<number> {
        let startPosition = 1;
        let moreRecords = true;
        let totalProcessed = 0;

        while (moreRecords) {
            const pageQuery = `${whereClause} STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`.trim();
            const rawRecords = await this.qbClient.query<any>(entity, pageQuery);

            if (!rawRecords || rawRecords.length === 0) {
                moreRecords = false;
                break;
            }

            totalProcessed += await processBatch(rawRecords);

            if (rawRecords.length < pageSize) {
                moreRecords = false;
            } else {
                startPosition += pageSize;
            }
        }

        return totalProcessed;
    }

    private async syncDeletions(entities: string[], changedSince: string): Promise<void> {
        try {
            const cdcData = await this.qbClient.cdc(entities, changedSince);
            const cdcResponses = cdcData?.CDCResponse || [];
            const tenantIdStr = String(this.tenantId);
            const realmIdStr = String(this.realmId);
            const purgedQbIds: string[] = [];

            for (const response of cdcResponses) {
                for (const queryResp of response.QueryResponse || []) {
                    const deletedObjects = queryResp.deletedObject || [];
                    if (deletedObjects.length === 0) continue;

                    for (const item of deletedObjects) {
                        if (!item.name || !item.id) continue;
                        const qbId = String(item.id);
                        purgedQbIds.push(qbId);

                        // Strict multi-tenant isolation on all delete operations
                        switch (item.name) {
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

            if (purgedQbIds.length > 0) {
                await this.autoResolveDeletedIssues(purgedQbIds);
            }
        } catch (error) {
            this.logger.error('CDC Deletion check failed', error as Error);
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

        const issueIdsToResolve = openIssues
            .filter((issue) => {
                const entityList = (issue.entities as Array<{ qbId: string }>) || [];
                return entityList.some((e) => deletedQbIds.includes(String(e.qbId)));
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
    private async syncTransactionWithBankMapping(
        entityType: 'Purchase' | 'JournalEntry' | 'Deposit' | 'Transfer',
        syncStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged(entityType, '', async (batch) => {
            // 1. Map & Upsert standard transaction records
            const txMapped = batch.map((item) =>
                this.mapper.mapTransaction(item, this.realmId, this.tenantId, entityType, syncStartTime)
            );
            const savedTxCount = await this.batchService.batchUpsert(prisma, txMapped, 'Transaction', this.realmId);

            // 2. Simultaneously map & upsert unified bank activity from same batch
            const bankMapped = batch
                .map((item) =>
                    this.mapper.mapToUnifiedBankTransaction(item, entityType, this.realmId, this.tenantId, syncStartTime)
                )
                .filter((m) => m !== null);

            if (bankMapped.length > 0) {
                await this.batchService.batchUpsert(prisma, bankMapped, 'BankTransaction', this.realmId);
            }

            return savedTxCount;
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