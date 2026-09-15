import { createLogger } from '@qb-health/utils';
import { RealmId } from '@qb-health/financial-model';
import { BatchUpsertOptions } from './sync-types';

function chunk<T>(array: T[], size: number): T[][] {
    const chunked: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunked.push(array.slice(i, i + size));
    }
    return chunked;
}

export interface ExtendedBatchUpsertOptions extends BatchUpsertOptions {
    chunkSize?: number;
    concurrencyLimit?: number;
}

export class BatchUpsertService {
    private logger = createLogger({ name: 'BatchUpsertService' });

    private isDecimal(val: any): boolean {
        return (
            val !== null &&
            typeof val === 'object' &&
            (val.constructor?.name === 'Decimal' ||
                (typeof val.toFixed === 'function' && typeof val.toNumber === 'function' && !Array.isArray(val)))
        );
    }

    private deduplicateRecords<T extends Record<string, any>>(records: T[]): T[] {
        const map = new Map<string, T>();

        for (const record of records) {
            const key = `${record.tenantId ?? ''}:${record.realmId ?? ''}:${record.qbId ?? record.id ?? ''}`;
            map.set(key, record);
        }

        return Array.from(map.values());
    }

    async batchUpsert<T extends Record<string, any>>(
        prisma: any,
        records: T[],
        tableName: string,
        realmId: RealmId,
        options: ExtendedBatchUpsertOptions = {}
    ): Promise<number> {
        // DEFAULT concurrencyLimit set to 1 to eliminate Postgres row lock contention deadlocks
        const { chunkSize = 500, concurrencyLimit = 1 } = options;
        let successfulCount = 0;

        if (!records || records.length === 0) {
            return successfulCount;
        }

        const uniqueRecords = this.deduplicateRecords(records);
        const batches = chunk(uniqueRecords, chunkSize);

        this.logger.info(`Starting batch upsert for ${tableName}`, {
            tableName,
            realmId,
            totalRecords: records.length,
            uniqueRecords: uniqueRecords.length,
            batchCount: batches.length
        });

        const sampleRecord = uniqueRecords[0];
        const columns = Object.keys(sampleRecord);
        const quotedColumns = columns.map((c) => `"${c}"`).join(', ');

        const immutableColumns = new Set(['id', 'createdAt', 'realmId', 'tenantId', 'qbId']);
        const updateColumns = columns.filter((c) => !immutableColumns.has(c));

        const updateSet = updateColumns.length > 0
            ? updateColumns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
            : null;

        // Process batches sequentially or with controlled concurrency
        for (let i = 0; i < batches.length; i += concurrencyLimit) {
            const currentBatches = batches.slice(i, i + concurrencyLimit);

            await Promise.all(
                currentBatches.map(async (batch, index) => {
                    const batchNum = i + index + 1;
                    try {
                        const count = await this.executeBatchQuery(prisma, tableName, columns, quotedColumns, updateSet, batch);
                        successfulCount += count;
                        this.logger.info(`Completed batch ${batchNum}/${batches.length} for ${tableName}`, {
                            tableName,
                            realmId,
                            batchSize: batch.length
                        });
                    } catch (error) {
                        const errorObj = error instanceof Error ? error : new Error(String(error));
                        this.logger.warn(`Batch ${batchNum} failed for ${tableName}. Executing single-row fallback.`, {
                            tableName,
                            realmId,
                            error: errorObj.message
                        });

                        const fallbackCount = await this.executeIndividualFallback(prisma, tableName, columns, quotedColumns, updateSet, batch, realmId);
                        successfulCount += fallbackCount;
                    }
                })
            );
        }

        this.logger.info(`Finished batch upsert for ${tableName}`, {
            tableName,
            realmId,
            successfulCount
        });

        return successfulCount;
    }

    private async executeBatchQuery<T extends Record<string, any>>(
        prisma: any,
        tableName: string,
        columns: string[],
        quotedColumns: string,
        updateSet: string | null,
        batch: T[]
    ): Promise<number> {
        const values: any[] = [];
        const valueStrings: string[] = [];
        let paramIndex = 1;

        for (const record of batch) {
            const recordValues: string[] = [];
            for (const col of columns) {
                let cast = '';
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

                recordValues.push(`$${paramIndex++}${cast}`);
            }
            valueStrings.push(`(${recordValues.join(', ')})`);
        }

        const conflictClause = updateSet
            ? `DO UPDATE SET ${updateSet}`
            : `DO NOTHING`;

        let query = `
            INSERT INTO "${tableName}" (${quotedColumns})
            VALUES ${valueStrings.join(', ')}
            ON CONFLICT ("tenantId", "realmId", "qbId")
            ${conflictClause}
        `;

        if (updateSet && columns.includes('updatedAt')) {
            query += ` WHERE "${tableName}"."updatedAt" < EXCLUDED."updatedAt" OR "${tableName}"."updatedAt" IS NULL`;
        }

        await prisma.$executeRawUnsafe(query, ...values);
        return batch.length;
    }

    private async executeIndividualFallback<T extends Record<string, any>>(
        prisma: any,
        tableName: string,
        columns: string[],
        quotedColumns: string,
        updateSet: string | null,
        batch: T[],
        realmId: RealmId
    ): Promise<number> {
        let saved = 0;
        for (const singleRecord of batch) {
            try {
                await this.executeBatchQuery(prisma, tableName, columns, quotedColumns, updateSet, [singleRecord]);
                saved++;
            } catch (err) {
                const errorObj = err instanceof Error ? err : new Error(String(err));
                this.logger.error(`Skipping record in ${tableName}`, errorObj, {
                    tableName,
                    realmId,
                    qbId: singleRecord.qbId
                });
            }
        }
        return saved;
    }
}