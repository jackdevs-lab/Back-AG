import { prisma, RealmId } from '@qb-health/financial-model';
import { createQbClient } from '@qb-health/qb-client';
import { createLogger } from '@qb-health/utils';
import { BatchUpsertService } from './batch-upsert.service';
import { Mapper, TenantId } from './mapper';
import { SupportedEntityType, SyncResult } from './sync-types';

interface ExtendedSyncResult extends Omit<SyncResult, 'nextWatermark'> {
    nextWatermark?: Date;
}

export class DeltaSync {
    private realmId: RealmId;
    private tenantId: TenantId;
    private logger: any;
    private mapper: Mapper;
    private batchService: BatchUpsertService;

    constructor(realmId: RealmId, tenantId: string) {
        this.realmId = realmId;
        this.tenantId = tenantId as TenantId;
        this.logger = createLogger({ realmId, tenantId });
        this.mapper = new Mapper();
        this.batchService = new BatchUpsertService();
    }

    async runDeltaSync(): Promise<SyncResult[]> {
        const startTime = Date.now();
        const syncSessionStartTime = new Date();

        this.logger.info('Starting delta sync', {
            realmId: this.realmId,
            tenantId: this.tenantId,
        });

        const qbClient = await createQbClient(this.realmId, this.tenantId);
        const results: SyncResult[] = [];

        const entities: SupportedEntityType[] = [
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

        for (const entityType of entities) {
            try {
                const entityLastSync = await prisma.qbSyncState.findUnique({
                    where: {
                        realmId_entityType: {
                            realmId: String(this.realmId),
                            entityType,
                        },
                    },
                });

                const since = entityLastSync?.lastSyncAt || new Date(0);
                const adjustedSince = new Date(since.getTime() - 30000);

                const result = await this.syncEntity(
                    qbClient,
                    entityType,
                    adjustedSince,
                    syncSessionStartTime
                );
                results.push(result);

                if (result.status === 'SUCCESS') {
                    const extendedResult = result as ExtendedSyncResult;
                    const nextWatermark =
                        extendedResult.nextWatermark || syncSessionStartTime;

                    await prisma.qbSyncState.upsert({
                        where: {
                            realmId_entityType: {
                                realmId: String(this.realmId),
                                entityType,
                            },
                        },
                        update: { lastSyncAt: nextWatermark },
                        create: {
                            tenantId: String(this.tenantId),
                            realmId: String(this.realmId),
                            entityType,
                            lastSyncAt: nextWatermark,
                        },
                    });
                }
            } catch (error) {
                this.logger.error(
                    `Delta sync failed for ${entityType}`,
                    error as Error
                );
                results.push(
                    this.createFailedResult(
                        entityType,
                        error as Error,
                        Date.now() - startTime
                    )
                );
            }
        }

        try {
            await this.syncDeletions(qbClient, entities, syncSessionStartTime);
        } catch (error) {
            this.logger.error('Deletion sync failed', error as Error);
        }

        this.logger.info('Delta sync completed', {
            realmId: this.realmId,
            tenantId: this.tenantId,
            durationMs: Date.now() - startTime,
            success: results.every(
                (r) => r.status === 'SUCCESS' || r.entityType === 'Deletions'
            ),
        });

        return results;
    }

    private async syncEntity(
        qbClient: any,
        entityType: SupportedEntityType,
        since: Date,
        syncSessionStartTime: Date
    ): Promise<ExtendedSyncResult> {
        const startTime = Date.now();
        const sinceStr = this.formatToPacificOffset(since);

        let totalSavedCount = 0;
        let maxUpdatedTime = since.getTime();

        try {
            const whereClause = `WHERE MetaData.LastUpdatedTime >= '${sinceStr}'`;
            const records = await qbClient.query(entityType, whereClause, 500);

            if (!records || records.length === 0) {
                return this.createSuccessResult(
                    entityType,
                    0,
                    Date.now() - startTime,
                    since
                );
            }

            let savedCount = 0;

            switch (entityType) {
                case 'Account': {
                    const mapped = records.map((r: any) =>
                        this.mapper.mapAccount(
                            r,
                            this.realmId,
                            this.tenantId,
                            syncSessionStartTime
                        )
                    );
                    savedCount = await this.batchService.batchUpsert(
                        prisma,
                        mapped,
                        'Account',
                        this.realmId
                    );
                    break;
                }
                case 'Customer': {
                    const mapped = records.map((r: any) =>
                        this.mapper.mapCustomer(
                            r,
                            this.realmId,
                            this.tenantId,
                            syncSessionStartTime
                        )
                    );
                    savedCount = await this.batchService.batchUpsert(
                        prisma,
                        mapped,
                        'Customer',
                        this.realmId
                    );
                    break;
                }
                case 'Vendor': {
                    const mapped = records.map((r: any) =>
                        this.mapper.mapVendor(
                            r,
                            this.realmId,
                            this.tenantId,
                            syncSessionStartTime
                        )
                    );
                    savedCount = await this.batchService.batchUpsert(
                        prisma,
                        mapped,
                        'Vendor',
                        this.realmId
                    );
                    break;
                }
                default: {
                    const mapped = records.map((r: any) =>
                        this.mapper.mapTransaction(
                            r,
                            this.realmId,
                            this.tenantId,
                            entityType,
                            syncSessionStartTime
                        )
                    );
                    savedCount = await this.batchService.batchUpsert(
                        prisma,
                        mapped,
                        'Transaction',
                        this.realmId
                    );

                    const bankRelatedEntities = [
                        'Purchase',
                        'Deposit',
                        'Transfer',
                        'JournalEntry',
                    ];
                    if (bankRelatedEntities.includes(entityType)) {
                        const bankMapped = records
                            .map((r: any) =>
                                this.mapper.mapToUnifiedBankTransaction(
                                    r,
                                    entityType,
                                    this.realmId,
                                    this.tenantId,
                                    syncSessionStartTime
                                )
                            )
                            .filter((m: any) => m !== null);

                        if (bankMapped.length > 0) {
                            await this.batchService.batchUpsert(
                                prisma,
                                bankMapped,
                                'BankTransaction',
                                this.realmId
                            );
                        }
                    }
                    break;
                }
            }

            totalSavedCount += savedCount;

            records.forEach((record: any) => {
                if (record.MetaData && record.MetaData.LastUpdatedTime) {
                    const recordTime = new Date(
                        record.MetaData.LastUpdatedTime
                    ).getTime();
                    if (recordTime > maxUpdatedTime) {
                        maxUpdatedTime = recordTime;
                    }
                }
            });

            const nextWatermark = new Date(maxUpdatedTime + 1000);

            return this.createSuccessResult(
                entityType,
                totalSavedCount,
                Date.now() - startTime,
                nextWatermark
            );
        } catch (error) {
            this.logger.error(
                `Failed to query/sync ${entityType}`,
                error as Error
            );
            return this.createFailedResult(
                entityType,
                error as Error,
                Date.now() - startTime
            ) as ExtendedSyncResult;
        }
    }

    private async syncDeletions(
        qbClient: any,
        entities: SupportedEntityType[],
        since: Date
    ): Promise<void> {
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
                const realmIdStr = String(this.realmId);
                const tenantId = String(this.tenantId);

                switch (entityName) {
                    case 'Account':
                        await prisma.account.deleteMany({
                            where: {
                                tenantId,
                                realmId: realmIdStr,
                                qbId: { in: deletedIds },
                            },
                        });
                        break;
                    case 'Customer':
                        await prisma.customer.deleteMany({
                            where: {
                                tenantId,
                                realmId: realmIdStr,
                                qbId: { in: deletedIds },
                            },
                        });
                        break;
                    case 'Vendor':
                        await prisma.vendor.deleteMany({
                            where: {
                                tenantId,
                                realmId: realmIdStr,
                                qbId: { in: deletedIds },
                            },
                        });
                        break;
                    default:
                        await prisma.transaction.deleteMany({
                            where: {
                                tenantId,
                                realmId: realmIdStr,
                                qbId: { in: deletedIds },
                            },
                        });
                        break;
                }

                this.logger.info(
                    `Purged ${deletedIds.length} deleted ${entityName} records`,
                    {
                        realmId: this.realmId,
                        tenantId: this.tenantId,
                    }
                );
            }
        }
    }

    private createSuccessResult(
        entityType: string,
        recordsSynced: number,
        durationMs: number,
        nextWatermark?: Date
    ): ExtendedSyncResult {
        return {
            realmId: this.realmId,
            entityType,
            recordsSynced,
            durationMs,
            status: 'SUCCESS',
            nextWatermark,
        };
    }

    private createFailedResult(
        entityType: string,
        error: Error,
        durationMs: number
    ): SyncResult {
        return {
            realmId: this.realmId,
            entityType,
            recordsSynced: 0,
            durationMs,
            status: 'FAILED',
            errorMessage: error.message,
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
            hourCycle: 'h23',
        });

        const parts = formatter.formatToParts(date);
        const partMap = new Map(parts.map((p) => [p.type, p.value]));

        const year = partMap.get('year');
        const month = partMap.get('month');
        const day = partMap.get('day');
        const hour = partMap.get('hour');
        const minute = partMap.get('minute');
        const second = partMap.get('second');

        const tzString = date.toLocaleString('en-US', {
            timeZone: 'America/Los_Angeles',
            timeZoneName: 'longOffset',
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
}