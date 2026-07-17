import { createLogger } from '@qb-health/utils';
import { RealmId, QbId } from '@qb-health/financial-model';
import { chunk } from './sync-engine';
import { BatchUpsertOptions } from './sync-types';

export interface PrismaUpsertDelegate<T> {
    upsert(args: {
        where: { realmId_qbId: { realmId: RealmId; qbId: QbId } };
        update: Partial<T>;
        create: T;
    }): Promise<T>;
    findUnique(args: {
        where: { realmId_qbId: { realmId: RealmId; qbId: QbId } };
        select: { updatedAt: boolean };
    }): Promise<{ updatedAt: Date | string } | null>;
}

export interface ExtendedBatchUpsertOptions extends BatchUpsertOptions {
    chunkSize?: number;
    concurrencyLimit?: number;
}

export class BatchUpsertService {
    private logger = createLogger({ name: 'BatchUpsertService' });

    async batchUpsert<T extends { qbId: QbId; updatedAt?: Date | string }>(
        records: T[],
        model: PrismaUpsertDelegate<T>,
        entityType: string,
        realmId: RealmId,
        options: ExtendedBatchUpsertOptions = {}
    ): Promise<string[]> {
        const { chunkSize = 50, concurrencyLimit = 5 } = options;
        const successfulIds: string[] = []; // Changed to store IDs

        const batches = chunk(records, chunkSize);
        const executing = new Set<Promise<void>>();

        for (const batch of batches) {
            const batchPromise = (async () => {
                const results = await Promise.allSettled(
                    batch.map(async (record) => {
                        const existing = await model.findUnique({
                            where: { realmId_qbId: { realmId, qbId: record.qbId } },
                            select: { updatedAt: true }
                        });

                        if (existing && existing.updatedAt && record.updatedAt) {
                            const existingDate = new Date(existing.updatedAt);
                            const incomingDate = new Date(record.updatedAt);

                            if (existingDate >= incomingDate) {
                                return record;
                            }
                        }

                        return model.upsert({
                            where: { realmId_qbId: { realmId, qbId: record.qbId } },
                            update: record,
                            create: record
                        });
                    })
                );

                const batchSuccessIds: string[] = [];
                results.forEach((res, idx) => {
                    if (res.status === 'fulfilled') {
                        batchSuccessIds.push(String(batch[idx].qbId)); // Capture stringified ID
                    } else {
                        const failedQbId = batch[idx].qbId;
                        const errorObj = res.reason instanceof Error
                            ? res.reason
                            : new Error(String(res.reason));
                        this.logger.error(
                            `Upsert failed for ${entityType} ID: ${failedQbId}`,
                            errorObj,
                            {
                                entityType,
                                realmId,
                                qbId: failedQbId
                            }
                        );
                    }
                });

                return batchSuccessIds;
            })();

            const p = batchPromise.then((ids) => {
                successfulIds.push(...ids);
                executing.delete(p);
            });

            executing.add(p);

            if (executing.size >= concurrencyLimit) {
                await Promise.race(executing);
            }
        }
        await Promise.all(executing);

        return successfulIds;
    }
}