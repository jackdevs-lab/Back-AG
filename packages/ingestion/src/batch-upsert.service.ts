import { createLogger } from '@qb-health/utils';
import { RealmId } from '@qb-health/financial-model';
import { chunk } from './sync-engine';
import { BatchUpsertOptions } from './sync-types';

export interface ExtendedBatchUpsertOptions extends BatchUpsertOptions {
    chunkSize?: number;
    concurrencyLimit?: number;
}

export class BatchUpsertService {
    private logger = createLogger({ name: 'BatchUpsertService' });

    /**
     * Checks if a value is a Prisma/Decimal.js Decimal instance
     */
    private isDecimal(val: any): boolean {
        return (
            val !== null &&
            typeof val === 'object' &&
            (val.constructor?.name === 'Decimal' ||
                (typeof val.toFixed === 'function' && typeof val.toNumber === 'function' && !Array.isArray(val)))
        );
    }

    async batchUpsert<T extends Record<string, any>>(
        prisma: any,
        records: T[],
        tableName: string,
        realmId: RealmId,
        options: ExtendedBatchUpsertOptions = {}
    ): Promise<number> {
        const { chunkSize = 500, concurrencyLimit = 5 } = options;
        let successfulCount = 0;

        if (!records.length) {
            return successfulCount;
        }

        const batches = chunk(records, chunkSize);
        const executing = new Set<Promise<void>>();

        const sampleRecord = records[0];
        const columns = Object.keys(sampleRecord).filter((k) => k !== 'realmId');
        columns.unshift('realmId');

        const quotedColumns = columns.map((c) => `"${c}"`).join(', ');

        const updateSet = columns
            .filter((c) => c !== 'realmId' && c !== 'qbId')
            .map((c) => `"${c}" = EXCLUDED."${c}"`)
            .join(', ');

        for (const batch of batches) {
            const batchPromise = (async () => {
                try {
                    const values: any[] = [];
                    const valueStrings: string[] = [];
                    let paramIndex = 1;

                    for (const record of batch) {
                        const recordValues: string[] = [];
                        for (const col of columns) {
                            let cast = '';
                            if (col === 'realmId') {
                                values.push(realmId);
                            } else {
                                const val = record[col];
                                if (val instanceof Date) {
                                    values.push(val);
                                } else if (this.isDecimal(val)) {
                                    values.push(val.toString());
                                    cast = '::numeric';
                                } else if (typeof val === 'object' && val !== null) {
                                    values.push(JSON.stringify(val));
                                    cast = '::jsonb';
                                } else {
                                    values.push(val ?? null);
                                }
                            }
                            recordValues.push(`$${paramIndex++}${cast}`);
                        }
                        valueStrings.push(`(${recordValues.join(', ')})`);
                    }

                    let query = `
                        INSERT INTO "${tableName}" (${quotedColumns})
                        VALUES ${valueStrings.join(', ')}
                        ON CONFLICT ("realmId", "qbId")
                        DO UPDATE SET ${updateSet}
                    `;

                    if (columns.includes('updatedAt')) {
                        query += ` WHERE "${tableName}"."updatedAt" < EXCLUDED."updatedAt" OR "${tableName}"."updatedAt" IS NULL`;
                    }

                    await prisma.$executeRawUnsafe(query, ...values);
                    successfulCount += batch.length;

                } catch (error) {
                    const errorObj = error instanceof Error ? error : new Error(String(error));
                    this.logger.error(`Bulk upsert failed for table ${tableName}`, errorObj, {
                        tableName,
                        realmId,
                        batchSize: batch.length,
                    });
                }
            })();

            const p = batchPromise.then(() => {
                executing.delete(p);
            });

            executing.add(p);

            if (executing.size >= concurrencyLimit) {
                await Promise.race(executing);
            }
        }

        await Promise.all(executing);
        return successfulCount;
    }
}