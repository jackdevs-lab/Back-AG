import { prisma, RealmId, BrandedRepository, PrismaBrandedRepository, BrandedSyncStatus } from '@qb-health/financial-model';
import { createQbClient } from '@qb-health/qb-client';
import { createLogger } from '@qb-health/utils';
import { Mapper } from './mapper';
//import { DeltaSync } from './delta-sync';
import { SyncResult as BaseSyncResult, SupportedEntityType } from './sync-types';
import { BatchUpsertService } from './batch-upsert.service';

// Extended type to carry the IDs downstream for the sweep
export interface SyncResult extends BaseSyncResult {
    syncedIds?: string[];
}

export function chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

export class SyncEngine {
    private realmId: RealmId;
    private logger: any;
    private mapper: Mapper;
    //private deltaSync: DeltaSync;
    private batchService: BatchUpsertService;
    private repo: BrandedRepository;

    constructor(realmId: RealmId) {
        this.realmId = realmId;
        this.logger = createLogger({ realmId });
        this.mapper = new Mapper();
        //this.deltaSync = new DeltaSync(realmId);
        this.batchService = new BatchUpsertService();
        this.repo = new PrismaBrandedRepository(prisma);
    }

    async runFullSync(): Promise<SyncResult[]> {
        const startTime = Date.now();

        this.logger.info('Starting full sync', { realmId: this.realmId });
        await this.repo.updateQbConnectionStatus(this.realmId, 'SYNCING' as BrandedSyncStatus);

        try {
            const qbClient = await createQbClient(this.realmId);

            const baseEntities: Array<{ type: SupportedEntityType; sync: () => Promise<SyncResult> }> = [
                { type: 'Account', sync: () => this.syncAccounts(qbClient) },
                { type: 'Customer', sync: () => this.syncCustomers(qbClient) },
                { type: 'Vendor', sync: () => this.syncVendors(qbClient) }
            ];

            const transactionalEntities: Array<{ type: string; sync: () => Promise<SyncResult> }> = [
                { type: 'Invoice', sync: () => this.syncInvoices(qbClient) },
                { type: 'Bill', sync: () => this.syncBills(qbClient) },
                { type: 'Payment', sync: () => this.syncPayments(qbClient) },
                { type: 'Purchase', sync: () => this.syncPurchases(qbClient) },
                { type: 'JournalEntry', sync: () => this.syncJournalEntries(qbClient) },
                { type: 'Deposit', sync: () => this.syncDeposits(qbClient) },
                { type: 'Transfer', sync: () => this.syncTransfers(qbClient) },
                { type: 'BankActivity', sync: () => this.syncBankActivity(qbClient) }
            ];

            const allResults: SyncResult[] = [];

            this.logger.info('Syncing base entities sequentially...', { realmId: this.realmId });
            for (const entity of baseEntities) {
                try {
                    const result = await entity.sync();
                    allResults.push(result);
                    this.logger.debug(`Completed sync for base entity: ${entity.type}`, { realmId: this.realmId });
                } catch (error) {
                    this.logger.error(`Failed to sync base ${entity.type}`, error as Error, { entityType: entity.type, realmId: this.realmId });
                    // Explicitly typed as SyncResult to prevent string widening
                    const errorResult: SyncResult = {
                        realmId: this.realmId,
                        entityType: entity.type,
                        recordsSynced: 0,
                        durationMs: 0,
                        status: 'FAILED',
                        errorMessage: (error as Error).message
                    };
                    allResults.push(errorResult);
                }
            }

            this.logger.info('Starting parallel sync for transactional entities...', { realmId: this.realmId });
            const txPromises = transactionalEntities.map(async (entity) => {
                try {
                    return await entity.sync();
                } catch (error) {
                    this.logger.error(`Failed to sync transactional ${entity.type}`, error as Error, { entityType: entity.type, realmId: this.realmId });
                    // Explicitly typed as SyncResult to prevent string widening
                    const errorResult: SyncResult = {
                        realmId: this.realmId,
                        entityType: entity.type,
                        recordsSynced: 0,
                        durationMs: 0,
                        status: 'FAILED',
                        errorMessage: (error as Error).message
                    };
                    return errorResult;
                }
            });

            const transactionalResults = await Promise.all(txPromises);
            allResults.push(...transactionalResults);

            // -------------------------------------------------------------
            // UPSERT-THEN-SWEEP: Atomic Deletion Phase
            // -------------------------------------------------------------
            this.logger.info('Executing Reconciliation Sweep...', { realmId: this.realmId });

            const sweepOperations: any[] = [];

            for (const res of allResults) {
                if (res.status === 'SUCCESS' && res.syncedIds) {
                    const realmIdStr = String(this.realmId);

                    switch (res.entityType) {
                        case 'Account':
                            sweepOperations.push(prisma.account.deleteMany({ where: { realmId: realmIdStr, qbId: { notIn: res.syncedIds } } }));
                            break;
                        case 'Customer':
                            sweepOperations.push(prisma.customer.deleteMany({ where: { realmId: realmIdStr, qbId: { notIn: res.syncedIds } } }));
                            break;
                        case 'Vendor':
                            sweepOperations.push(prisma.vendor.deleteMany({ where: { realmId: realmIdStr, qbId: { notIn: res.syncedIds } } }));
                            break;
                        case 'Invoice':
                        case 'Bill':
                        case 'Payment':
                        case 'Purchase':
                        case 'JournalEntry':
                        case 'Deposit':
                        case 'Transfer':
                            sweepOperations.push(prisma.transaction.deleteMany({
                                where: { realmId: realmIdStr, type: res.entityType, qbId: { notIn: res.syncedIds } }
                            }));
                            break;
                        case 'BankActivity':
                            sweepOperations.push(prisma.bankTransaction.deleteMany({ where: { realmId: realmIdStr, qbId: { notIn: res.syncedIds } } }));
                            break;
                    }
                }
            }

            if (sweepOperations.length > 0) {
                await prisma.$transaction(sweepOperations);
                this.logger.info('Reconciliation Sweep completed successfully.', { realmId: this.realmId, sweptModels: sweepOperations.length });
            }

            await this.repo.updateQbConnectionStatus(this.realmId, 'IDLE' as BrandedSyncStatus, new Date());

            this.logger.info('Full sync completed', {
                realmId: this.realmId,
                durationMs: Date.now() - startTime,
                entitiesProcessed: allResults.length
            });

            return allResults.map(({ syncedIds, ...rest }) => rest);

        } catch (error) {
            this.logger.error('Full sync failed during execution phase', error as Error, { realmId: this.realmId });
            await this.repo.updateQbConnectionStatus(this.realmId, 'ERROR' as BrandedSyncStatus, new Date());
            throw error;
        }
    }

    /*async runDeltaSync(): Promise<SyncResult[]> {
        return this.deltaSync.runDeltaSync();
    }*/

    // Pagination loop already enforces STARTPOSITION / MAXRESULTS correctly
    private async fetchAllPages(qbClient: any, entity: string, criteria: string = ''): Promise<any[]> {
        let allRecords: any[] = [];
        let startPosition = 1;
        let hasMore = true;
        const formattedCriteria = criteria ? `${criteria} ` : '';

        while (hasMore) {
            const page = await qbClient.query(entity, `${formattedCriteria}STARTPOSITION ${startPosition} MAXRESULTS 500`);
            allRecords = allRecords.concat(page);
            if (page.length < 500) {
                hasMore = false;
            } else {
                startPosition += 500;
            }
        }
        return allRecords;
    }

    private createSuccessResult(entityType: string, recordsSynced: number, durationMs: number, syncedIds: string[] = []): SyncResult {
        return {
            realmId: this.realmId,
            entityType,
            recordsSynced,
            durationMs,
            status: 'SUCCESS',
            syncedIds
        };
    }

    private async syncAccounts(qbClient: any): Promise<SyncResult> {
        const startTime = Date.now();
        const accounts = await this.fetchAllPages(qbClient, 'Account', 'WHERE Active = true');
        const mapped = accounts.map((a: any) => this.mapper.mapAccount(a, this.realmId));
        const savedIds = await this.batchService.batchUpsert(mapped as any, prisma.account as any, 'Account', this.realmId);
        return this.createSuccessResult('Account', savedIds.length, Date.now() - startTime, savedIds);
    }

    private async syncCustomers(qbClient: any): Promise<SyncResult> {
        const startTime = Date.now();
        const customers = await this.fetchAllPages(qbClient, 'Customer', 'WHERE Active = true');
        const mapped = customers.map((c: any) => this.mapper.mapCustomer(c, this.realmId));
        const savedIds = await this.batchService.batchUpsert(mapped as any, prisma.customer as any, 'Customer', this.realmId);
        return this.createSuccessResult('Customer', savedIds.length, Date.now() - startTime, savedIds);
    }

    private async syncVendors(qbClient: any): Promise<SyncResult> {
        const startTime = Date.now();
        const vendors = await this.fetchAllPages(qbClient, 'Vendor', 'WHERE Active = true');
        const mapped = vendors.map((v: any) => this.mapper.mapVendor(v, this.realmId));
        const savedIds = await this.batchService.batchUpsert(mapped as any, prisma.vendor as any, 'Vendor', this.realmId);
        return this.createSuccessResult('Vendor', savedIds.length, Date.now() - startTime, savedIds);
    }

    private async syncInvoices(qbClient: any): Promise<SyncResult> {
        const startTime = Date.now();
        const invoices = await this.fetchAllPages(qbClient, 'Invoice');
        const mapped = invoices.map((i: any) => this.mapper.mapTransaction(i, this.realmId, 'Invoice'));
        const savedIds = await this.batchService.batchUpsert(mapped as any, prisma.transaction as any, 'Invoice', this.realmId);
        return this.createSuccessResult('Invoice', savedIds.length, Date.now() - startTime, savedIds);
    }

    private async syncBills(qbClient: any): Promise<SyncResult> {
        const startTime = Date.now();
        const bills = await this.fetchAllPages(qbClient, 'Bill');
        const mapped = bills.map((b: any) => this.mapper.mapTransaction(b, this.realmId, 'Bill'));
        const savedIds = await this.batchService.batchUpsert(mapped as any, prisma.transaction as any, 'Bill', this.realmId);
        return this.createSuccessResult('Bill', savedIds.length, Date.now() - startTime, savedIds);
    }

    private async syncPayments(qbClient: any): Promise<SyncResult> {
        const startTime = Date.now();
        const payments = await this.fetchAllPages(qbClient, 'Payment');
        const mapped = payments.map((p: any) => this.mapper.mapTransaction(p, this.realmId, 'Payment'));
        const savedIds = await this.batchService.batchUpsert(mapped as any, prisma.transaction as any, 'Payment', this.realmId);
        return this.createSuccessResult('Payment', savedIds.length, Date.now() - startTime, savedIds);
    }

    private async syncPurchases(qbClient: any): Promise<SyncResult> {
        const startTime = Date.now();
        const purchases = await this.fetchAllPages(qbClient, 'Purchase');
        const mapped = purchases.map((p: any) => this.mapper.mapTransaction(p, this.realmId, 'Purchase'));
        const savedIds = await this.batchService.batchUpsert(mapped as any, prisma.transaction as any, 'Purchase', this.realmId);
        return this.createSuccessResult('Purchase', savedIds.length, Date.now() - startTime, savedIds);
    }

    private async syncJournalEntries(qbClient: any): Promise<SyncResult> {
        const startTime = Date.now();
        const entries = await this.fetchAllPages(qbClient, 'JournalEntry');
        const mapped = entries.map((e: any) => this.mapper.mapTransaction(e, this.realmId, 'JournalEntry'));
        const savedIds = await this.batchService.batchUpsert(mapped as any, prisma.transaction as any, 'JournalEntry', this.realmId);
        return this.createSuccessResult('JournalEntry', savedIds.length, Date.now() - startTime, savedIds);
    }

    private async syncDeposits(qbClient: any): Promise<SyncResult> {
        const startTime = Date.now();
        const deposits = await this.fetchAllPages(qbClient, 'Deposit');
        const mapped = deposits.map((d: any) => this.mapper.mapTransaction(d, this.realmId, 'Deposit'));
        const savedIds = await this.batchService.batchUpsert(mapped as any, prisma.transaction as any, 'Deposit', this.realmId);
        return this.createSuccessResult('Deposit', savedIds.length, Date.now() - startTime, savedIds);
    }

    private async syncTransfers(qbClient: any): Promise<SyncResult> {
        const startTime = Date.now();
        const transfers = await this.fetchAllPages(qbClient, 'Transfer');
        const mapped = transfers.map((t: any) => this.mapper.mapTransaction(t, this.realmId, 'Transfer'));
        const savedIds = await this.batchService.batchUpsert(mapped as any, prisma.transaction as any, 'Transfer', this.realmId);
        return this.createSuccessResult('Transfer', savedIds.length, Date.now() - startTime, savedIds);
    }

    private async syncBankActivity(qbClient: any): Promise<SyncResult> {
        const startTime = Date.now();
        const bankEntities = ['Purchase', 'Deposit', 'Transfer', 'JournalEntry'];

        let allBankActivityIds: string[] = [];

        for (const entity of bankEntities) {
            const records = await this.fetchAllPages(qbClient, entity);

            const mapped = records.map((record: any) =>
                this.mapper.mapToUnifiedBankTransaction(record, entity, this.realmId as any)
            );

            if (mapped.length > 0) {
                const savedIds = await this.batchService.batchUpsert(
                    mapped as any,
                    prisma.bankTransaction as any,
                    'BankTransaction',
                    this.realmId
                );
                allBankActivityIds.push(...savedIds);
            }
        }

        return this.createSuccessResult('BankActivity', allBankActivityIds.length, Date.now() - startTime, allBankActivityIds);
    }
}