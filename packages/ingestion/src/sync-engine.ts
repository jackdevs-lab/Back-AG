import {
    BrandedRepository,
    BrandedSyncStatus,
    PrismaBrandedRepository,
    RealmId,
    prisma,
} from '@qb-health/financial-model';
import { QbApiClient, createQbClient } from '@qb-health/qb-client';
import { createLogger } from '@qb-health/utils';
import { BatchUpsertService } from './batch-upsert.service';
import { Mapper, TenantId } from './mapper';
import { SupportedEntityType, SyncResult } from './sync-types';

export function chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

export class SyncEngine {
    private realmId: RealmId;
    private qbClient: QbApiClient;
    private tenantId: string;
    private logger: any;
    private mapper: Mapper;
    private batchService: BatchUpsertService;
    private repo: BrandedRepository;

    constructor(realmId: RealmId, tenantId: string, qbClient: QbApiClient) {
        this.realmId = realmId;
        this.tenantId = tenantId;
        this.qbClient = qbClient;
        this.logger = createLogger({ realmId, tenantId });
        this.mapper = new Mapper();
        this.batchService = new BatchUpsertService();
        this.repo = new PrismaBrandedRepository(prisma);
    }

    async runFullSync(): Promise<SyncResult[]> {
        const startTime = Date.now();
        const syncSessionStartTime = new Date();

        this.logger.info('Starting full sync', {
            realmId: this.realmId,
            tenantId: this.tenantId,
        });
        await this.repo.updateQbConnectionStatus(
            this.tenantId,
            this.realmId,
            'SYNCING' as BrandedSyncStatus
        );

        try {
            const qbClient = await createQbClient(this.realmId, this.tenantId);
            const allResults: SyncResult[] = [];

            const baseEntities: Array<{
                type: SupportedEntityType;
                sync: () => Promise<SyncResult>;
            }> = [
                    {
                        type: 'Account',
                        sync: () => this.syncAccounts(qbClient, syncSessionStartTime),
                    },
                    {
                        type: 'Customer',
                        sync: () => this.syncCustomers(qbClient, syncSessionStartTime),
                    },
                    {
                        type: 'Vendor',
                        sync: () => this.syncVendors(qbClient, syncSessionStartTime),
                    },
                ];

            const transactionalEntities: Array<{
                type: string;
                sync: () => Promise<SyncResult>;
            }> = [
                    {
                        type: 'Invoice',
                        sync: () => this.syncInvoices(qbClient, syncSessionStartTime),
                    },
                    {
                        type: 'Bill',
                        sync: () => this.syncBills(qbClient, syncSessionStartTime),
                    },
                    {
                        type: 'Payment',
                        sync: () => this.syncPayments(qbClient, syncSessionStartTime),
                    },
                    {
                        type: 'Purchase',
                        sync: () => this.syncPurchases(qbClient, syncSessionStartTime),
                    },
                    {
                        type: 'JournalEntry',
                        sync: () => this.syncJournalEntries(qbClient, syncSessionStartTime),
                    },
                    {
                        type: 'Deposit',
                        sync: () => this.syncDeposits(qbClient, syncSessionStartTime),
                    },
                    {
                        type: 'Transfer',
                        sync: () => this.syncTransfers(qbClient, syncSessionStartTime),
                    },
                    {
                        type: 'BankActivity',
                        sync: () => this.syncBankActivity(qbClient, syncSessionStartTime),
                    },
                ];

            this.logger.info('Syncing base entities sequentially...', {
                realmId: this.realmId,
            });
            let hasBaseFailure = false;

            for (const entity of baseEntities) {
                try {
                    const result = await entity.sync();
                    allResults.push(result);
                } catch (error) {
                    hasBaseFailure = true;
                    this.logger.error(
                        `Failed to sync base entity ${entity.type}`,
                        error as Error,
                        {
                            entityType: entity.type,
                            realmId: this.realmId,
                        }
                    );
                    allResults.push(
                        this.createFailedResult(entity.type, (error as Error).message)
                    );
                }
            }

            if (hasBaseFailure) {
                throw new Error(
                    'Base entity synchronization failed. Aborting transactional entity sync to protect integrity.'
                );
            }

            this.logger.info(
                'Starting sequential sync for transactional entities...',
                { realmId: this.realmId }
            );
            for (const entity of transactionalEntities) {
                try {
                    const result = await entity.sync();
                    allResults.push(result);
                } catch (error) {
                    this.logger.error(
                        `Failed to sync transactional entity ${entity.type}`,
                        error as Error,
                        {
                            entityType: entity.type,
                            realmId: this.realmId,
                        }
                    );
                    allResults.push(
                        this.createFailedResult(entity.type, (error as Error).message)
                    );
                }
            }

            const allEntityTypes: SupportedEntityType[] = [
                'Account',
                'Customer',
                'Vendor',
                'Invoice',
                'Bill',
                'Payment',
                'Purchase',
                'JournalEntry',
                'Deposit',
                'Transfer',
            ];
            // Pass only entities and changedSince
            await this.syncDeletions(qbClient, allEntityTypes, syncSessionStartTime.toISOString());
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
            this.logger.error(
                'Full sync failed during execution phase',
                error as Error,
                {
                    realmId: this.realmId,
                    tenantId: this.tenantId,
                }
            );
            await this.repo.updateQbConnectionStatus(
                this.tenantId,
                this.realmId,
                'ERROR' as BrandedSyncStatus,
                new Date()
            );
            throw error;
        }
    }

    private createSuccessResult(
        entityType: string,
        recordsSynced: number,
        durationMs: number
    ): SyncResult {
        return {
            realmId: this.realmId,
            entityType,
            recordsSynced,
            durationMs,
            status: 'SUCCESS',
        };
    }

    private createFailedResult(
        entityType: string,
        errorMessage: string
    ): SyncResult {
        return {
            realmId: this.realmId,
            entityType,
            recordsSynced: 0,
            durationMs: 0,
            status: 'FAILED',
            errorMessage,
        };
    }

    private async fetchAndProcessInBatches(
        qbClient: QbApiClient,
        entity: string,
        whereClause: string,
        processBatch: (batch: any[]) => Promise<number>
    ): Promise<number> {
        const rawRecords = await qbClient.query<any>(entity, whereClause);
        let totalProcessed = 0;

        const batches = chunk(rawRecords, 500);
        for (const batch of batches) {
            if (batch.length > 0) {
                totalProcessed += await processBatch(batch);
            }
        }

        return totalProcessed;
    }

    // Notice we are passing qbClient as the first parameter now, and NOT using 'this.qbClient'
    private async syncDeletions(qbClient: QbApiClient, entities: string[], changedSince: string): Promise<void> {
        try {
            const cdcData = await qbClient.cdc(entities, changedSince);
            const cdcResponses = cdcData?.CDCResponse || [];

            for (const response of cdcResponses) {
                for (const queryResp of response.QueryResponse || []) {
                    const deletedObjects = queryResp.deletedObject || [];

                    for (const item of deletedObjects) {
                        this.logger.info(`CDC Deletion detected for ${item.name} ID: ${item.id}`);

                        if (item.name === 'Customer') {
                            await prisma.customer.deleteMany({
                                where: { qbId: item.id, realmId: this.realmId },
                            });
                        } else if (item.name === 'Vendor') {
                            await prisma.vendor.deleteMany({
                                where: { qbId: item.id, realmId: this.realmId },
                            });
                        } else {
                            await prisma.transaction.deleteMany({
                                where: { qbId: item.id, realmId: this.realmId },
                            });
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.error({ error }, 'CDC Deletion check failed');
        }
    }
    private async syncAccounts(
        qbClient: QbApiClient,
        syncSessionStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessInBatches(
            qbClient,
            'Account',
            'WHERE Active = true',
            async (batch) => {
                const mapped = batch.map((a) =>
                    this.mapper.mapAccount(
                        a,
                        this.realmId,
                        this.tenantId as TenantId,
                        syncSessionStartTime
                    )
                );
                return this.batchService.batchUpsert(
                    prisma,
                    mapped,
                    'Account',
                    this.realmId
                );
            }
        );
        return this.createSuccessResult('Account', count, Date.now() - startTime);
    }

    private async syncCustomers(
        qbClient: QbApiClient,
        syncSessionStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessInBatches(
            qbClient,
            'Customer',
            'WHERE Active = true',
            async (batch) => {
                const mapped = batch.map((c) =>
                    this.mapper.mapCustomer(
                        c,
                        this.realmId,
                        this.tenantId as TenantId,
                        syncSessionStartTime
                    )
                );
                return this.batchService.batchUpsert(
                    prisma,
                    mapped,
                    'Customer',
                    this.realmId
                );
            }
        );
        return this.createSuccessResult('Customer', count, Date.now() - startTime);
    }

    private async syncVendors(
        qbClient: QbApiClient,
        syncSessionStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessInBatches(
            qbClient,
            'Vendor',
            'WHERE Active = true',
            async (batch) => {
                const mapped = batch.map((v) =>
                    this.mapper.mapVendor(
                        v,
                        this.realmId,
                        this.tenantId as TenantId,
                        syncSessionStartTime
                    )
                );
                return this.batchService.batchUpsert(
                    prisma,
                    mapped,
                    'Vendor',
                    this.realmId
                );
            }
        );
        return this.createSuccessResult('Vendor', count, Date.now() - startTime);
    }

    private async syncInvoices(
        qbClient: QbApiClient,
        syncSessionStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessInBatches(
            qbClient,
            'Invoice',
            '',
            async (batch) => {
                const mapped = batch.map((i) =>
                    this.mapper.mapTransaction(
                        i,
                        this.realmId,
                        this.tenantId as TenantId,
                        'Invoice',
                        syncSessionStartTime
                    )
                );
                return this.batchService.batchUpsert(
                    prisma,
                    mapped,
                    'Transaction',
                    this.realmId
                );
            }
        );
        return this.createSuccessResult('Invoice', count, Date.now() - startTime);
    }

    private async syncBills(
        qbClient: QbApiClient,
        syncSessionStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessInBatches(
            qbClient,
            'Bill',
            '',
            async (batch) => {
                const mapped = batch.map((b) =>
                    this.mapper.mapTransaction(
                        b,
                        this.realmId,
                        this.tenantId as TenantId,
                        'Bill',
                        syncSessionStartTime
                    )
                );
                return this.batchService.batchUpsert(
                    prisma,
                    mapped,
                    'Transaction',
                    this.realmId
                );
            }
        );
        return this.createSuccessResult('Bill', count, Date.now() - startTime);
    }

    private async syncPayments(
        qbClient: QbApiClient,
        syncSessionStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessInBatches(
            qbClient,
            'Payment',
            '',
            async (batch) => {
                const mapped = batch.map((p) =>
                    this.mapper.mapTransaction(
                        p,
                        this.realmId,
                        this.tenantId as TenantId,
                        'Payment',
                        syncSessionStartTime
                    )
                );
                return this.batchService.batchUpsert(
                    prisma,
                    mapped,
                    'Transaction',
                    this.realmId
                );
            }
        );
        return this.createSuccessResult('Payment', count, Date.now() - startTime);
    }

    private async syncPurchases(
        qbClient: QbApiClient,
        syncSessionStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessInBatches(
            qbClient,
            'Purchase',
            '',
            async (batch) => {
                const mapped = batch.map((p) =>
                    this.mapper.mapTransaction(
                        p,
                        this.realmId,
                        this.tenantId as TenantId,
                        'Purchase',
                        syncSessionStartTime
                    )
                );
                return this.batchService.batchUpsert(
                    prisma,
                    mapped,
                    'Transaction',
                    this.realmId
                );
            }
        );
        return this.createSuccessResult('Purchase', count, Date.now() - startTime);
    }

    private async syncJournalEntries(
        qbClient: QbApiClient,
        syncSessionStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessInBatches(
            qbClient,
            'JournalEntry',
            '',
            async (batch) => {
                const mapped = batch.map((e) =>
                    this.mapper.mapTransaction(
                        e,
                        this.realmId,
                        this.tenantId as TenantId,
                        'JournalEntry',
                        syncSessionStartTime
                    )
                );
                return this.batchService.batchUpsert(
                    prisma,
                    mapped,
                    'Transaction',
                    this.realmId
                );
            }
        );
        return this.createSuccessResult(
            'JournalEntry',
            count,
            Date.now() - startTime
        );
    }

    private async syncDeposits(
        qbClient: QbApiClient,
        syncSessionStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessInBatches(
            qbClient,
            'Deposit',
            '',
            async (batch) => {
                const mapped = batch.map((d) =>
                    this.mapper.mapTransaction(
                        d,
                        this.realmId,
                        this.tenantId as TenantId,
                        'Deposit',
                        syncSessionStartTime
                    )
                );
                return this.batchService.batchUpsert(
                    prisma,
                    mapped,
                    'Transaction',
                    this.realmId
                );
            }
        );
        return this.createSuccessResult('Deposit', count, Date.now() - startTime);
    }

    private async syncTransfers(
        qbClient: QbApiClient,
        syncSessionStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const count = await this.fetchAndProcessInBatches(
            qbClient,
            'Transfer',
            '',
            async (batch) => {
                const mapped = batch.map((t) =>
                    this.mapper.mapTransaction(
                        t,
                        this.realmId,
                        this.tenantId as TenantId,
                        'Transfer',
                        syncSessionStartTime
                    )
                );
                return this.batchService.batchUpsert(
                    prisma,
                    mapped,
                    'Transaction',
                    this.realmId
                );
            }
        );
        return this.createSuccessResult('Transfer', count, Date.now() - startTime);
    }

    private async syncBankActivity(
        qbClient: QbApiClient,
        syncSessionStartTime: Date
    ): Promise<SyncResult> {
        const startTime = Date.now();
        const bankEntities = ['Purchase', 'Deposit', 'Transfer', 'JournalEntry'];
        let recordsProcessed = 0;

        for (const entity of bankEntities) {
            recordsProcessed += await this.fetchAndProcessInBatches(
                qbClient,
                entity,
                '',
                async (batch) => {
                    const mapped = batch
                        .map((record) =>
                            this.mapper.mapToUnifiedBankTransaction(
                                record,
                                entity,
                                this.realmId,
                                this.tenantId as TenantId,
                                syncSessionStartTime
                            )
                        )
                        .filter((m) => m !== null);

                    if (mapped.length > 0) {
                        return this.batchService.batchUpsert(
                            prisma,
                            mapped,
                            'BankTransaction',
                            this.realmId
                        );
                    }
                    return 0;
                }
            );
        }

        return this.createSuccessResult(
            'BankActivity',
            recordsProcessed,
            Date.now() - startTime
        );
    }
}