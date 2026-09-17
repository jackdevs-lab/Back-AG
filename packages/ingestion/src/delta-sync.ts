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
    private connectionId?: string;
    private logger: ReturnType<typeof createLogger>;
    private mapper: Mapper;
    private batchService: BatchUpsertService;

    constructor(realmId: RealmId, tenantId: string, connectionId?: string) {
        this.realmId = realmId;
        this.tenantId = tenantId as TenantId;
        this.connectionId = connectionId;
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

        let earliestWatermark = syncSessionStartTime;

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
                if (since < earliestWatermark) {
                    earliestWatermark = since;
                }

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
            // Track deletions since the earliest watermark among all entities
            await this.syncDeletions(qbClient, entities, earliestWatermark);
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
        const sinceStr = since.toISOString();

        let totalSavedCount = 0;
        let maxUpdatedTime = since.getTime();
        let startPosition = 1;
        const maxResults = 1000;
        let hasMore = true;

        try {
            while (hasMore) {
                const whereClause = `WHERE MetaData.LastUpdatedTime >= '${sinceStr}' STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`;
                const records = await qbClient.query(entityType, whereClause);

                if (!records || records.length === 0) {
                    hasMore = false;
                    break;
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
                    if (record.MetaData?.LastUpdatedTime) {
                        const recordTime = new Date(
                            record.MetaData.LastUpdatedTime
                        ).getTime();
                        if (recordTime > maxUpdatedTime) {
                            maxUpdatedTime = recordTime;
                        }
                    }
                });

                if (records.length < maxResults) {
                    hasMore = false;
                } else {
                    startPosition += maxResults;
                }
            }

            const nextWatermark =
                maxUpdatedTime > since.getTime()
                    ? new Date(maxUpdatedTime + 1000)
                    : syncSessionStartTime;

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
    ): Promise<string[]> {
        const sinceStr = since.toISOString();
        const cdcResponse = await qbClient.cdc(entities, sinceStr);

        if (!cdcResponse || !cdcResponse.CDCResponse) return [];

        const allDeletedQbIds: string[] = [];

        for (const cdcEntity of cdcResponse.CDCResponse) {
            for (const queryResp of cdcEntity.QueryResponse || []) {
                const deletedObjects = queryResp.deletedObject || [];
                if (deletedObjects.length === 0) continue;

                const deletedByEntity: Record<string, string[]> = {};
                for (const item of deletedObjects) {
                    if (!item.name || !item.id) continue;
                    if (!deletedByEntity[item.name]) {
                        deletedByEntity[item.name] = [];
                    }
                    deletedByEntity[item.name].push(String(item.id));
                    allDeletedQbIds.push(String(item.id));
                }

                const realmIdStr = String(this.realmId);
                const tenantId = String(this.tenantId);

                for (const [entityName, deletedIds] of Object.entries(deletedByEntity)) {
                    if (deletedIds.length === 0) continue;

                    switch (entityName) {
                        case 'Account':
                            await prisma.account.deleteMany({
                                where: { tenantId, realmId: realmIdStr, qbId: { in: deletedIds } },
                            });
                            break;
                        case 'Customer':
                            await prisma.customer.deleteMany({
                                where: { tenantId, realmId: realmIdStr, qbId: { in: deletedIds } },
                            });
                            break;
                        case 'Vendor':
                            await prisma.vendor.deleteMany({
                                where: { tenantId, realmId: realmIdStr, qbId: { in: deletedIds } },
                            });
                            break;
                        default:
                            await prisma.transaction.deleteMany({
                                where: { tenantId, realmId: realmIdStr, qbId: { in: deletedIds } },
                            });
                            await prisma.bankTransaction.deleteMany({
                                where: { tenantId, realmId: realmIdStr, qbId: { in: deletedIds } },
                            });
                            break;
                    }

                    this.logger.info(
                        `Purged ${deletedIds.length} deleted ${entityName} records`,
                        { realmId: this.realmId, tenantId: this.tenantId }
                    );
                }
            }
        }

        if (allDeletedQbIds.length > 0) {
            await this.autoResolveDeletedIssues(allDeletedQbIds);
        }

        return allDeletedQbIds;
    }

    private async autoResolveDeletedIssues(deletedQbIds: string[]): Promise<void> {
        if (deletedQbIds.length === 0) return;

        const whereCondition = this.connectionId
            ? { connectionId: String(this.connectionId), isResolved: false }
            : { tenantId: String(this.tenantId), realmId: String(this.realmId), isResolved: false };

        const CHUNK = 5000;
        const issueIds = new Set<string>();

        for (let i = 0; i < deletedQbIds.length; i += CHUNK) {
            const slice = deletedQbIds.slice(i, i + CHUNK);
            const found = await prisma.issue.findMany({
                where: {
                    ...whereCondition,
                    entities: { some: { entityId: { in: slice } } },
                },
                select: { id: true },
            });
            for (const row of found) issueIds.add(row.id);
        }

        if (issueIds.size === 0) return;

        await prisma.issue.updateMany({
            where: { id: { in: [...issueIds] } },
            data: { isResolved: true, resolvedAt: new Date() },
        });

        this.logger.info(
            `Auto-resolved ${issueIds.size} issues corresponding to deleted QBO entities`,
            { realmId: this.realmId, tenantId: this.tenantId }
        );
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
}