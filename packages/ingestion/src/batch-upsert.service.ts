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

// Table-specific unique constraint mapping based on schema.prisma
const TABLE_CONFLICT_TARGETS: Record<string, string[]> = {
    RuleFinding: ['tenantId', 'realmId', 'ruleId', 'qbId', 'syncToken'],
    RuleConfig: ['tenantId', 'realmId', 'ruleId'],
    QbSyncState: ['realmId', 'entityType'],
    QbConnection: ['tenantId', 'realmId'],
    User: ['tenantId', 'email'],
    // Default target for Account, Transaction, Customer, Vendor, BankTransaction, Reconciliation
    DEFAULT: ['tenantId', 'realmId', 'qbId']
};

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

    private getConflictColumns(tableName: string): string[] {
        return TABLE_CONFLICT_TARGETS[tableName] || TABLE_CONFLICT_TARGETS.DEFAULT;
    }

    private deduplicateRecords<T extends Record<string, any>>(records: T[], tableName: string): T[] {
        const map = new Map<string, T>();
        const keyColumns = this.getConflictColumns(tableName);

        for (const record of records) {
            const key = keyColumns.map((col) => String(record[col] ?? '')).join(':');
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
        const { chunkSize = 500, concurrencyLimit = 1 } = options;
        let successfulCount = 0;

        if (!records || records.length === 0) {
            return successfulCount;
        }

        const uniqueRecords = this.deduplicateRecords(records, tableName);
        const batches = chunk(uniqueRecords, chunkSize);

        this.logger.info(`Starting batch upsert for ${tableName}`, {
            tableName,
            realmId,
            totalRecords: records.length,
            uniqueRecords: uniqueRecords.length,
            batchCount: batches.length
        });

        // Collect all distinct keys across all records to prevent missing column syntax errors
        const columnSet = new Set<string>();
        for (const record of uniqueRecords) {
            Object.keys(record).forEach((col) => columnSet.add(col));
        }
        const columns = Array.from(columnSet);
        const quotedColumns = columns.map((c) => `"${c}"`).join(', ');

        const conflictColumns = this.getConflictColumns(tableName);
        const quotedConflictTargets = conflictColumns.map((c) => `"${c}"`).join(', ');

        const immutableColumns = new Set(['id', 'createdAt', ...conflictColumns]);
        const updateColumns = columns.filter((c) => !immutableColumns.has(c));

        const updateSet = updateColumns.length > 0
            ? updateColumns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
            : null;

        for (let i = 0; i < batches.length; i += concurrencyLimit) {
            const currentBatches = batches.slice(i, i + concurrencyLimit);

            await Promise.all(
                currentBatches.map(async (batch, index) => {
                    const batchNum = i + index + 1;
                    try {
                        const count = await this.executeBatchQuery(
                            prisma,
                            tableName,
                            columns,
                            quotedColumns,
                            quotedConflictTargets,
                            updateSet,
                            batch
                        );
                        successfulCount += count;
                        this.logger.info(`Completed batch ${batchNum}/${batches.length} for ${tableName}`, {
                            tableName,
                            realmId,
                            batchSize: batch.length
                        });
                    } catch (error: any) {
                        const errorMsg = error?.message || String(error);

                        // Prevent individual fallback loops for structural SQL errors (e.g. missing constraint or table)
                        if (error?.code === '42704' || errorMsg.includes('ON CONFLICT')) {
                            this.logger.error(`Fatal SQL constraint mismatch for ${tableName}. Aborting batch without fallback.`, error, {
                                tableName,
                                realmId
                            });
                            throw error;
                        }

                        this.logger.warn(`Batch ${batchNum} failed for ${tableName}. Executing throttled single-row fallback.`, {
                            tableName,
                            realmId,
                            error: errorMsg
                        });

                        const fallbackCount = await this.executeIndividualFallback(
                            prisma,
                            tableName,
                            columns,
                            quotedColumns,
                            quotedConflictTargets,
                            updateSet,
                            batch,
                            realmId
                        );
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
        quotedConflictTargets: string,
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
            ON CONFLICT (${quotedConflictTargets})
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
        quotedConflictTargets: string,
        updateSet: string | null,
        batch: T[],
        realmId: RealmId
    ): Promise<number> {
        let saved = 0;
        let errorCount = 0;

        for (const singleRecord of batch) {
            try {
                await this.executeBatchQuery(
                    prisma,
                    tableName,
                    columns,
                    quotedColumns,
                    quotedConflictTargets,
                    updateSet,
                    [singleRecord]
                );
                saved++;
            } catch (err) {
                errorCount++;
                // Limit individual log output to prevent Railway log rate-limit saturation
                if (errorCount <= 3) {
                    const errorObj = err instanceof Error ? err : new Error(String(err));
                    this.logger.error(`Fallback failed for row in ${tableName}`, errorObj, {
                        tableName,
                        realmId,
                        qbId: singleRecord.qbId
                    });
                }
            }
        }

        if (errorCount > 3) {
            this.logger.error(`Suppressed ${errorCount - 3} additional fallback error logs for ${tableName} to preserve log quotas.`);
        }

        return saved;
    }
}