import { prisma, RealmId, BrandedRepository, PrismaBrandedRepository, BrandedSyncStatus } from '@qb-health/financial-model';
import { createQbClient } from '@qb-health/qb-client';
import { createLogger } from '@qb-health/utils';
import { Mapper } from './mapper';
import { SyncResult, SupportedEntityType } from './sync-types';
import { BatchUpsertService } from './batch-upsert.service';

export function chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

export class SyncEngine {
    private realmId: RealmId;
    private tenantId: string;
    private logger: any;
    private mapper: Mapper;
    private batchService: BatchUpsertService;
    private repo: BrandedRepository;

    constructor(realmId: RealmId, tenantId: string) {
        this.realmId = realmId;
        this.tenantId = tenantId;
        this.logger = createLogger({ realmId, tenantId });
        this.mapper = new Mapper();
        this.batchService = new BatchUpsertService();
        this.repo = new PrismaBrandedRepository(prisma);
    }

    async runFullSync(): Promise<SyncResult[]> {
        const startTime = Date.now();
        const syncSessionStartTime = new Date();

        this.logger.info('Starting full sync', { realmId: this.realmId, tenantId: this.tenantId });
        await this.repo.updateQbConnectionStatus(this.tenantId, this.realmId, 'SYNCING' as BrandedSyncStatus);

        try {
            const qbClient = await createQbClient(this.realmId, this.tenantId);

            const baseEntities: Array<{ type: SupportedEntityType; sync: () => Promise<SyncResult> }> = [
                { type: 'Account', sync: () => this.syncAccounts(qbClient, syncSessionStartTime) },
                { type: 'Customer', sync: () => this.syncCustomers(qbClient, syncSessionStartTime) },
                { type: 'Vendor', sync: () => this.syncVendors(qbClient, syncSessionStartTime) }
            ];

            const transactionalEntities: Array<{ type: string; sync: () => Promise<SyncResult> }> = [
                { type: 'Invoice', sync: () => this.syncInvoices(qbClient, syncSessionStartTime) },
                { type: 'Bill', sync: () => this.syncBills(qbClient, syncSessionStartTime) },
                { type: 'Payment', sync: () => this.syncPayments(qbClient, syncSessionStartTime) },
                { type: 'Purchase', sync: () => this.syncPurchases(qbClient, syncSessionStartTime) },
                { type: 'JournalEntry', sync: () => this.syncJournalEntries(qbClient, syncSessionStartTime) },
                { type: 'Deposit', sync: () => this.syncDeposits(qbClient, syncSessionStartTime) },
                { type: 'Transfer', sync: () => this.syncTransfers(qbClient, syncSessionStartTime) },
                { type: 'BankActivity', sync: () => this.syncBankActivity(qbClient, syncSessionStartTime) }
            ];

            const allResults: SyncResult[] = [];

            this.logger.info('Syncing base entities sequentially...', { realmId: this.realmId });
            for (const entity of baseEntities) {
                try {
                    const result = await entity.sync();
                    allResults.push(result);
                } catch (error) {
                    this.logger.error(`Failed to sync base ${entity.type}`, error as Error, { entityType: entity.type, realmId: this.realmId });
                    allResults.push(this.createFailedResult(entity.type, (error as Error).message));
                }
            }

            this.logger.info('Starting sequential sync for transactional entities...', { realmId: this.realmId });
            for (const entity of transactionalEntities) {
                try {
                    const result = await entity.sync();
                    allResults.push(result);
                } catch (error) {
                    this.logger.error(`Failed to sync transactional ${entity.type}`, error as Error, { entityType: entity.type, realmId: this.realmId });
                    allResults.push(this.createFailedResult(entity.type, (error as Error).message));
                }
            }

            this.logger.info('Executing Reconciliation Sweep...', { realmId: this.realmId });
            const realmIdStr = String(this.realmId);

            const sweepOperations = [
                prisma.account.deleteMany({ where: { realmId: realmIdStr, lastSyncedAt: { lt: syncSessionStartTime } } }),
                prisma.customer.deleteMany({ where: { realmId: realmIdStr, lastSyncedAt: { lt: syncSessionStartTime } } }),
                prisma.vendor.deleteMany({ where: { realmId: realmIdStr, lastSyncedAt: { lt: syncSessionStartTime } } }),
                prisma.transaction.deleteMany({ where: { realmId: realmIdStr, lastSyncedAt: { lt: syncSessionStartTime } } }),
                prisma.bankTransaction.deleteMany({ where: { realmId: realmIdStr, lastSyncedAt: { lt: syncSessionStartTime } } })
            ];

            await prisma.$transaction(sweepOperations);
            this.logger.info('Reconciliation Sweep completed successfully.', { realmId: this.realmId });

            await this.repo.updateQbConnectionStatus(this.tenantId, this.realmId, 'IDLE' as BrandedSyncStatus, new Date());

            this.logger.info('Full sync completed', {
                realmId: this.realmId,
                tenantId: this.tenantId,
                durationMs: Date.now() - startTime,
                entitiesProcessed: allResults.length
            });

            return allResults;

        } catch (error) {
            this.logger.error('Full sync failed during execution phase', error as Error, { realmId: this.realmId, tenantId: this.tenantId });
            await this.repo.updateQbConnectionStatus(this.tenantId, this.realmId, 'ERROR' as BrandedSyncStatus, new Date());
            throw error;
        }
    }

    private async fetchAndProcessPages(
        qbClient: any,
        entity: string,
        criteria: string = '',
        processPage: (page: any[]) => Promise<void>
    ): Promise<void> {
        let startPosition = 1;
        let hasMore = true;
        const formattedCriteria = criteria ? `${criteria} ` : '';

        while (hasMore) {
            const page = await qbClient.query(entity, `${formattedCriteria}STARTPOSITION ${startPosition} MAXRESULTS 500`);

            if (page.length > 0) {
                await processPage(page);
            }

            if (page.length < 500) {
                hasMore = false;
            } else {
                startPosition += 500;
            }
        }
    }

    private createSuccessResult(entityType: string, recordsSynced: number, durationMs: number): SyncResult {
        return { realmId: this.realmId, entityType, recordsSynced, durationMs, status: 'SUCCESS' };
    }

    private createFailedResult(entityType: string, errorMessage: string): SyncResult {
        return { realmId: this.realmId, entityType, recordsSynced: 0, durationMs: 0, status: 'FAILED', errorMessage };
    }

    private async syncAccounts(qbClient: any, syncSessionStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        let recordsProcessed = 0;

        await this.fetchAndProcessPages(qbClient, 'Account', 'WHERE Active = true', async (page) => {
            const mapped = page.map((a: any) => this.mapper.mapAccount(a, this.realmId, syncSessionStartTime));
            recordsProcessed += await this.batchService.batchUpsert(prisma, mapped, 'Account', this.realmId);
        });

        return this.createSuccessResult('Account', recordsProcessed, Date.now() - startTime);
    }

    private async syncCustomers(qbClient: any, syncSessionStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        let recordsProcessed = 0;

        await this.fetchAndProcessPages(qbClient, 'Customer', 'WHERE Active = true', async (page) => {
            const mapped = page.map((c: any) => this.mapper.mapCustomer(c, this.realmId, syncSessionStartTime));
            recordsProcessed += await this.batchService.batchUpsert(prisma, mapped, 'Customer', this.realmId);
        });

        return this.createSuccessResult('Customer', recordsProcessed, Date.now() - startTime);
    }

    private async syncVendors(qbClient: any, syncSessionStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        let recordsProcessed = 0;

        await this.fetchAndProcessPages(qbClient, 'Vendor', 'WHERE Active = true', async (page) => {
            const mapped = page.map((v: any) => this.mapper.mapVendor(v, this.realmId, syncSessionStartTime));
            recordsProcessed += await this.batchService.batchUpsert(prisma, mapped, 'Vendor', this.realmId);
        });

        return this.createSuccessResult('Vendor', recordsProcessed, Date.now() - startTime);
    }

    private async syncInvoices(qbClient: any, syncSessionStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        let recordsProcessed = 0;

        await this.fetchAndProcessPages(qbClient, 'Invoice', '', async (page) => {
            const mapped = page.map((i: any) => this.mapper.mapTransaction(i, this.realmId, 'Invoice', syncSessionStartTime));
            recordsProcessed += await this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });

        return this.createSuccessResult('Invoice', recordsProcessed, Date.now() - startTime);
    }

    private async syncBills(qbClient: any, syncSessionStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        let recordsProcessed = 0;

        await this.fetchAndProcessPages(qbClient, 'Bill', '', async (page) => {
            const mapped = page.map((b: any) => this.mapper.mapTransaction(b, this.realmId, 'Bill', syncSessionStartTime));
            recordsProcessed += await this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });

        return this.createSuccessResult('Bill', recordsProcessed, Date.now() - startTime);
    }

    private async syncPayments(qbClient: any, syncSessionStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        let recordsProcessed = 0;

        await this.fetchAndProcessPages(qbClient, 'Payment', '', async (page) => {
            const mapped = page.map((p: any) => this.mapper.mapTransaction(p, this.realmId, 'Payment', syncSessionStartTime));
            recordsProcessed += await this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });

        return this.createSuccessResult('Payment', recordsProcessed, Date.now() - startTime);
    }

    private async syncPurchases(qbClient: any, syncSessionStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        let recordsProcessed = 0;

        await this.fetchAndProcessPages(qbClient, 'Purchase', '', async (page) => {
            const mapped = page.map((p: any) => this.mapper.mapTransaction(p, this.realmId, 'Purchase', syncSessionStartTime));
            recordsProcessed += await this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });

        return this.createSuccessResult('Purchase', recordsProcessed, Date.now() - startTime);
    }

    private async syncJournalEntries(qbClient: any, syncSessionStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        let recordsProcessed = 0;

        await this.fetchAndProcessPages(qbClient, 'JournalEntry', '', async (page) => {
            const mapped = page.map((e: any) => this.mapper.mapTransaction(e, this.realmId, 'JournalEntry', syncSessionStartTime));
            recordsProcessed += await this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });

        return this.createSuccessResult('JournalEntry', recordsProcessed, Date.now() - startTime);
    }

    private async syncDeposits(qbClient: any, syncSessionStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        let recordsProcessed = 0;

        await this.fetchAndProcessPages(qbClient, 'Deposit', '', async (page) => {
            const mapped = page.map((d: any) => this.mapper.mapTransaction(d, this.realmId, 'Deposit', syncSessionStartTime));
            recordsProcessed += await this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });

        return this.createSuccessResult('Deposit', recordsProcessed, Date.now() - startTime);
    }

    private async syncTransfers(qbClient: any, syncSessionStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        let recordsProcessed = 0;

        await this.fetchAndProcessPages(qbClient, 'Transfer', '', async (page) => {
            const mapped = page.map((t: any) => this.mapper.mapTransaction(t, this.realmId, 'Transfer', syncSessionStartTime));
            recordsProcessed += await this.batchService.batchUpsert(prisma, mapped, 'Transaction', this.realmId);
        });

        return this.createSuccessResult('Transfer', recordsProcessed, Date.now() - startTime);
    }

    private async syncBankActivity(qbClient: any, syncSessionStartTime: Date): Promise<SyncResult> {
        const startTime = Date.now();
        const bankEntities = ['Purchase', 'Deposit', 'Transfer', 'JournalEntry'];
        let recordsProcessed = 0;

        for (const entity of bankEntities) {
            await this.fetchAndProcessPages(qbClient, entity, '', async (page) => {
                const mapped = page
                    .map((record: any) => this.mapper.mapToUnifiedBankTransaction(record, entity, this.realmId, syncSessionStartTime))
                    .filter((m) => m !== null); // Ensure we don't pass nulls if mapping failed

                if (mapped.length > 0) {
                    recordsProcessed += await this.batchService.batchUpsert(
                        prisma,
                        mapped,
                        'BankTransaction',
                        this.realmId
                    );
                }
            });
        }

        return this.createSuccessResult('BankActivity', recordsProcessed, Date.now() - startTime);
    }
}