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
    private tenantId: string;
    private logger: any;
    private mapper: Mapper;
    private batchService: BatchUpsertService;
    private repo: BrandedRepository;

    constructor(
        realmId: RealmId,
        tenantId: string,
        qbClient: QbApiClient,
        mapper = new Mapper(),
        batchService = new BatchUpsertService(),
        repo: BrandedRepository = new PrismaBrandedRepository(prisma)
    ) {
        this.realmId = realmId;
        this.tenantId = tenantId;
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
            this.tenantId,
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

            const transactionalEntities: Array<{ type: string; sync: () => Promise<SyncResult> }> = [
                { type: 'Invoice', sync: () => this.syncInvoices(syncSessionStartTime) },
                { type: 'Bill', sync: () => this.syncBills(syncSessionStartTime) },
                { type: 'Payment', sync: () => this.syncPayments(syncSessionStartTime) },
                { type: 'Purchase', sync: () => this.syncPurchases(syncSessionStartTime) },
                { type: 'JournalEntry', sync: () => this.syncJournalEntries(syncSessionStartTime) },
                { type: 'Deposit', sync: () => this.syncDeposits(syncSessionStartTime) },
                { type: 'Transfer', sync: () => this.syncTransfers(syncSessionStartTime) },
                { type: 'BankActivity', sync: () => this.syncBankActivity(syncSessionStartTime) },
            ];

            // Execute Base Entities
            for (const entity of baseEntities) {
                try {
                    allResults.push(await entity.sync());
                } catch (error) {
                    this.logger.error(`Failed base entity ${entity.type}`, error as Error, { realmId: this.realmId });
                    allResults.push(this.createFailedResult(entity.type, (error as Error).message));
                    throw new Error(`Base entity ${entity.type} failed. Aborting full sync.`);
                }
            }

            // Execute Transactional Entities
            for (const entity of transactionalEntities) {
                try {
                    allResults.push(await entity.sync());
                } catch (error) {
                    this.logger.error(`Failed transactional entity ${entity.type}`, error as Error, { realmId: this.realmId });
                    allResults.push(this.createFailedResult(entity.type, (error as Error).message));
                }
            }

            // Sync Deletions
            const cdcTimestamp = syncSessionStartTime.toISOString().split('.')[0] + 'Z';
            const allEntityTypes: SupportedEntityType[] = [
                'Account', 'Customer', 'Vendor', 'Invoice', 'Bill',
                'Payment', 'Purchase', 'JournalEntry', 'Deposit', 'Transfer'
            ];
            await this.syncDeletions(allEntityTypes, cdcTimestamp);

            await this.repo.updateQbConnectionStatus(
                this.tenantId,
                this.realmId,
                'IDLE' as BrandedSyncStatus,
                new Date()
            );

            this.logger.info('Full sync completed', {
                realmId: this.realmId,
                tenantId: this.tenantId,
                durationMs: Date.now() - startTime,
                entitiesProcessed: allResults.length,
            });

            return allResults;
        } catch (error) {
            this.logger.error('Full sync failed during execution', error as Error, { realmId: this.realmId });
            await this.repo.updateQbConnectionStatus(
                this.tenantId,
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

            for (const response of cdcResponses) {
                for (const queryResp of response.QueryResponse || []) {
                    for (const item of queryResp.deletedObject || []) {
                        this.logger.info(`CDC Deletion detected for ${item.name} ID: ${item.id}`);

                        if (item.name === 'Customer') {
                            await prisma.customer.deleteMany({ where: { qbId: item.id, realmId: this.realmId } });
                        } else if (item.name === 'Vendor') {
                            await prisma.vendor.deleteMany({ where: { qbId: item.id, realmId: this.realmId } });
                        } else {
                            await prisma.transaction.deleteMany({ where: { qbId: item.id, realmId: this.realmId } });
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.error({ error }, 'CDC Deletion check failed');
        }
    }

    private async syncAccounts(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Account', 'WHERE Active = true', async (batch) => {
            const mapped = batch.map((a) => this.mapper.mapAccount(a, this.realmId, this.tenantId as TenantId, syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Account', this.realmId);
        });
        return this.createSuccessResult('Account', count, Date.now() - startTime);
    }

    private async syncCustomers(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Customer', 'WHERE Active = true', async (batch) => {
            const mapped = batch.map((c) => this.mapper.mapCustomer(c, this.realmId, this.tenantId as TenantId, syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Customer', this.realmId);
        });
        return this.createSuccessResult('Customer', count, Date.now() - startTime);
    }

    private async syncVendors(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Vendor', 'WHERE Active = true', async (batch) => {
            const mapped = batch.map((v) => this.mapper.mapVendor(v, this.realmId, this.tenantId as TenantId, syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Vendor', this.realmId);
        });
        return this.createSuccessResult('Vendor', count, Date.now() - startTime);
    }

    private async syncInvoices(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Invoice', '', async (batch) => {
            const mapped = batch.map((i) => this.mapper.mapTransaction(i, this.realmId, this.tenantId as TenantId, 'Invoice', syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });
        return this.createSuccessResult('Invoice', count, Date.now() - startTime);
    }

    private async syncBills(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Bill', '', async (batch) => {
            const mapped = batch.map((b) => this.mapper.mapTransaction(b, this.realmId, this.tenantId as TenantId, 'Bill', syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });
        return this.createSuccessResult('Bill', count, Date.now() - startTime);
    }

    private async syncPayments(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Payment', '', async (batch) => {
            const mapped = batch.map((p) => this.mapper.mapTransaction(p, this.realmId, this.tenantId as TenantId, 'Payment', syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });
        return this.createSuccessResult('Payment', count, Date.now() - startTime);
    }

    private async syncPurchases(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Purchase', '', async (batch) => {
            const mapped = batch.map((p) => this.mapper.mapTransaction(p, this.realmId, this.tenantId as TenantId, 'Purchase', syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });
        return this.createSuccessResult('Purchase', count, Date.now() - startTime);
    }

    private async syncJournalEntries(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('JournalEntry', '', async (batch) => {
            const mapped = batch.map((e) => this.mapper.mapTransaction(e, this.realmId, this.tenantId as TenantId, 'JournalEntry', syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });
        return this.createSuccessResult('JournalEntry', count, Date.now() - startTime);
    }

    private async syncDeposits(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Deposit', '', async (batch) => {
            const mapped = batch.map((d) => this.mapper.mapTransaction(d, this.realmId, this.tenantId as TenantId, 'Deposit', syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });
        return this.createSuccessResult('Deposit', count, Date.now() - startTime);
    }

    private async syncTransfers(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessPaged('Transfer', '', async (batch) => {
            const mapped = batch.map((t) => this.mapper.mapTransaction(t, this.realmId, this.tenantId as TenantId, 'Transfer', syncStartTime));
            return this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });
        return this.createSuccessResult('Transfer', count, Date.now() - startTime);
    }

    private async syncBankActivity(syncStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const bankEntities = ['Purchase', 'Deposit', 'Transfer', 'JournalEntry'];
        let recordsProcessed = 0;

        for (const entity of bankEntities) {
            recordsProcessed += await this.fetchAndProcessPaged(entity, '', async (batch) => {
                const mapped = batch
                    .map((record) =>
                        this.mapper.mapToUnifiedBankTransaction(
                            record,
                            entity,
                            this.realmId,
                            this.tenantId as TenantId,
                            syncStartTime
                        )
                    )
                    .filter((m) => m !== null);

                if (mapped.length > 0) {
                    return this.batchService.batchUpsert(prisma, mapped, 'BankTransaction', this.realmId);
                }
                return 0;
            });
        }

        return this.createSuccessResult('BankActivity', recordsProcessed, Date.now() - startTime);
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