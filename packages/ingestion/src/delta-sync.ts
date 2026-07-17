/* packages/ingestion/src/delta-sync.ts
import { Prisma, prisma, RealmId } from '@qb-health/financial-model';
import { createLogger } from '@qb-health/utils';
import { Mapper } from './mapper';
import { SyncResult, SupportedEntityType } from './sync-types';
import { BatchUpsertService } from './batch-upsert.service';
import { createQbClient } from '@qb-health/qb-client';
interface ExtendedSyncResult extends Omit<SyncResult, 'nextWatermark'> {
    nextWatermark?: Date;
}

export class DeltaSync {
    private realmId: RealmId;
    private logger: any;
    private mapper: Mapper;
    private batchService: BatchUpsertService;

    constructor(realmId: RealmId) {
        this.realmId = realmId;
        this.logger = createLogger({ realmId });
        this.mapper = new Mapper();
        this.batchService = new BatchUpsertService();
    }

    async runDeltaSync(): Promise<SyncResult[]> {
        const startTime = Date.now();
        this.logger.info('Starting delta sync', { realmId: this.realmId });

        const qbClient = await createQbClient(this.realmId);
        const results: SyncResult[] = [];

        const entities: SupportedEntityType[] = [
            'Account', 'Customer', 'Vendor', 'Invoice', 'Bill', 'Payment',
            'Purchase', 'JournalEntry', 'Deposit', 'Transfer'
        ];

        for (const entityType of entities) {
            try {
                const entityLastSync = await prisma.qbSyncState.findUnique({
                    where: { realmId_entityType: { realmId: this.realmId, entityType } }
                });

                const since = entityLastSync?.lastSyncAt || new Date(0);
                const adjustedSince = new Date(since.getTime() - 30000);

                const result = await this.syncEntity(qbClient, entityType, adjustedSince);
                results.push(result);

                if (result.status === 'SUCCESS') {
                    const extendedResult = result as ExtendedSyncResult;
                    const nextWatermark = extendedResult.nextWatermark || new Date();

                    await prisma.qbSyncState.upsert({
                        where: { realmId_entityType: { realmId: this.realmId, entityType } },
                        update: { lastSyncAt: nextWatermark },
                        create: { realmId: this.realmId, entityType, lastSyncAt: nextWatermark }
                    });
                }
            } catch (error) {
                this.logger.error(`Delta sync failed for ${entityType}`, error as Error);
                results.push(this.createFailedResult(entityType, error as Error, Date.now() - startTime));
            }
        }

        try {
            const deletionReferenceTime = new Date(startTime);
            await this.syncDeletions(qbClient, entities, deletionReferenceTime);
        } catch (error) {
            this.logger.error('Deletion sync failed', error as Error);
        }

        this.logger.info('Delta sync completed', {
            realmId: this.realmId,
            durationMs: Date.now() - startTime,
            success: results.every(r => r.status === 'SUCCESS' || r.entityType === 'Deletions')
        });

        return results;
    }

    private async syncEntity(qbClient: any, entityType: SupportedEntityType, since: Date): Promise<ExtendedSyncResult> {
        const startTime = Date.now();
        const sinceStr = this.formatToPacificOffset(since);

        let totalSavedCount = 0;
        let maxUpdatedTime = since.getTime();

        try {
            const whereClause = `WHERE MetaData.LastUpdatedTime >= '${sinceStr}'`;
            const records = await qbClient.query(entityType, whereClause, 500);

            if (!records || records.length === 0) {
                return this.createSuccessResult(entityType, 0, Date.now() - startTime, since);
            }

            let savedCount = 0;

            switch (entityType) {
                case 'Account':
                    const accMapped = records.map((r: any) => this.mapper.mapAccount(r, this.realmId));
                    savedCount = await this.batchService.batchUpsert(accMapped, prisma.account as any, entityType, this.realmId);
                    break;
                case 'Customer':
                    const custMapped = records.map((r: any) => this.mapper.mapCustomer(r, this.realmId));
                    savedCount = await this.batchService.batchUpsert(custMapped, prisma.customer as any, entityType, this.realmId);
                    break;
                case 'Vendor':
                    const vendMapped = records.map((r: any) => this.mapper.mapVendor(r, this.realmId));
                    savedCount = await this.batchService.batchUpsert(vendMapped, prisma.vendor as any, entityType, this.realmId);
                    break;
                default:
                    const txMapped = records.map((r: any) => this.mapper.mapTransaction(r, this.realmId, entityType));
                    savedCount = await this.batchService.batchUpsert(txMapped, prisma.transaction as any, entityType, this.realmId);

                    const bankRelatedEntities = ['Purchase', 'Deposit', 'Transfer', 'JournalEntry'];
                    if (bankRelatedEntities.includes(entityType)) {
                        const bankMapped = records.map((r: any) => this.mapper.mapToUnifiedBankTransaction(r, entityType, this.realmId));
                        await this.batchService.batchUpsert(bankMapped, prisma.bankTransaction as any, 'BankTransaction', this.realmId);
                    }
                    break;
            }

            totalSavedCount += savedCount;

            records.forEach((record: any) => {
                if (record.MetaData && record.MetaData.LastUpdatedTime) {
                    const recordTime = new Date(record.MetaData.LastUpdatedTime).getTime();
                    if (recordTime > maxUpdatedTime) {
                        maxUpdatedTime = recordTime;
                    }
                }
            });

            const nextWatermark = new Date(maxUpdatedTime + 1000);

            return this.createSuccessResult(entityType, totalSavedCount, Date.now() - startTime, nextWatermark);

        } catch (error) {
            this.logger.error(`Failed to query/sync ${entityType}`, error as Error);
            return this.createFailedResult(entityType, error as Error, Date.now() - startTime) as ExtendedSyncResult;
        }
    }

    private async syncDeletions(qbClient: any, entities: SupportedEntityType[], since: Date): Promise<void> {
        const sinceStr = since.toISOString().split('.')[0] + 'Z';
        const entitiesParam = entities.join(',');
        const cdcResponse = await qbClient.cdc(entitiesParam, sinceStr);

        if (!cdcResponse || !cdcResponse.CDCResponse) return;

        for (const cdcEntity of cdcResponse.CDCResponse) {
            const entityName = Object.keys(cdcEntity.QueryResponse[0] || {})[0];
            if (!entityName) continue;

            const records = cdcEntity.QueryResponse[0][entityName];
            if (!records) continue;

            const deletedIds = records
                .filter((r: any) => r.status === 'Deleted')
                .map((r: any) => r.Id);

            if (deletedIds.length > 0) {
                switch (entityName) {
                    case 'Account':
                        await prisma.account.deleteMany({ where: { realmId: this.realmId, qbId: { in: deletedIds } } });
                        break;
                    case 'Customer':
                        await prisma.customer.deleteMany({ where: { realmId: this.realmId, qbId: { in: deletedIds } } });
                        break;
                    case 'Vendor':
                        await prisma.vendor.deleteMany({ where: { realmId: this.realmId, qbId: { in: deletedIds } } });
                        break;
                    default:
                        await prisma.transaction.deleteMany({ where: { realmId: this.realmId, qbId: { in: deletedIds } } });
                        break;
                }

                this.logger.info(`Purged ${deletedIds.length} deleted ${entityName} records`, { realmId: this.realmId });
            }
        }
    }

    private createSuccessResult(entityType: string, recordsSynced: number, durationMs: number, nextWatermark?: Date): ExtendedSyncResult {
        return {
            realmId: this.realmId,
            entityType,
            recordsSynced,
            durationMs,
            status: 'SUCCESS',
            nextWatermark: nextWatermark
        };
    }

    private createFailedResult(entityType: string, error: Error, durationMs: number): SyncResult {
        return {
            realmId: this.realmId,
            entityType,
            recordsSynced: 0,
            durationMs,
            status: 'FAILED',
            errorMessage: error.message
        };
    }

    private formatToPacificOffset(date: Date): string {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        });

        const parts = formatter.formatToParts(date);
        const partMap = new Map(parts.map(p => [p.type, p.value]));

        const year = partMap.get('year');
        const month = partMap.get('month');
        const day = partMap.get('day');
        const hour = partMap.get('hour');
        const minute = partMap.get('minute');
        const second = partMap.get('second');

        const tzString = date.toLocaleString('en-US', { 
            timeZone: 'America/Los_Angeles', 
            timeZoneName: 'longOffset' 
        });
        const offsetMatch = tzString.match(/GMT([+-]\d+)(?::(\d+))?/);
        let offset = '-07:00';
        if (offsetMatch) {
            const sign = offsetMatch[1][0];
            const hours = offsetMatch[1].slice(1).padStart(2, '0');
            const minutes = (offsetMatch[2] || '00').padStart(2, '0');
            offset = `${sign}${hours}:${minutes}`;
        }

        return `${year}-${month}-${day}T${hour}:${minute}:${second}${offset}`;
    }
}*/