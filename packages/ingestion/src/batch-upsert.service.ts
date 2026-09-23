import { createLogger } from '@qb-health/utils';
import { RealmId } from '@qb-health/financial-model';
import { BatchUpsertOptions } from './sync-types';
// import { Prisma } from '@prisma/client'; // Uncomment if you need strict typing for TransactionClient

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
// Table-specific unique constraint mapping based on schema.prisma
const TABLE_CONFLICT_TARGETS: Record<string, string[]> = {
    // Composite-keyed tables (unchanged)
    RuleFinding: ['tenantId', 'realmId', 'ruleId', 'qbId'],
    RuleConfig: ['tenantId', 'realmId', 'ruleId'],
    QbSyncState: ['realmId', 'entityType'],
    QbConnection: ['realmId'],           // was ['tenantId', 'realmId'] — schema is now @@unique([realmId])
    User: ['tenantId', 'email'],

    // Entity tables — id is the primary key (realmId-qbId) and is what actually conflicts
    Transaction: ['id'],
    Account: ['id'],
    Customer: ['id'],
    Vendor: ['id'],
    BankTransaction: ['id'],
    Reconciliation: ['id'],

    DEFAULT: ['id'],
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

    // FIX 5.6 I6: Deduplication based on qbId + realmId, keeping the newest syncToken
    private deduplicateRecords<T extends Record<string, any>>(records: T[], tableName: string, realmId: string): T[] {
        const map = new Map<string, T>();
        for (const record of records) {
            const key = `${record.qbId}_${realmId}`;
            const existing = map.get(key);
            if (existing) {
                const existingToken = parseInt(existing.syncToken ?? '0', 10);
                const newToken = parseInt(record.syncToken ?? '0', 10);
                if (newToken > existingToken) {
                    map.set(key, record);
                }
                this.logger.warn('Duplicate record in batch, kept newest', {
                    tableName, key, existingToken, newToken,
                });
            } else {
                map.set(key, record);
            }
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
        return this.executeBatchQuery(prisma, records, tableName, String(realmId), options);
    }

    // FIX 5.4 C7: Expose transaction-aware variant for atomic dual-table batch upserts
    async batchUpsertTx(
        tx: any, // Prisma.TransactionClient
        records: Record<string, any>[],
        tableName: string,
        realmId: string
    ): Promise<number> {
        return this.executeBatchQuery(tx, records, tableName, realmId);
    }

    private async executeBatchQuery<T extends Record<string, any>>(
        client: any,
        records: T[],
        tableName: string,
        realmId: string,
        options: ExtendedBatchUpsertOptions = {}
    ): Promise<number> {
        const { chunkSize = 500, concurrencyLimit = 1 } = options;
        let successfulCount = 0;

        if (!records || records.length === 0) {
            return successfulCount;
        }

        const uniqueRecords = this.deduplicateRecords(records, tableName, realmId);
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

        // FIX 5.5 I5: COALESCE Update Columns to preserve existing data if incoming is null
        const updateSet = updateColumns.length > 0
            ? updateColumns
                .map((c) => `"${c}" = COALESCE(EXCLUDED."${c}", "${tableName}"."${c}")`)
                .join(', ')
            : null;

        for (let i = 0; i < batches.length; i += concurrencyLimit) {
            const currentBatches = batches.slice(i, i + concurrencyLimit);

            await Promise.all(
                currentBatches.map(async (batch, index) => {
                    const batchNum = i + index + 1;
                    try {
                        const count = await this.executeRawBatchQuery(
                            client,
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

                        // FIX 5.7 I8: Expand Structural Error Codes
                        const STRUCTURAL_PG_CODES = new Set([
                            '42P01', // undefined_table
                            '42703', // undefined_column
                            '42704', // undefined_object
                            '42601', // syntax_error
                            '42804', // datatype_mismatch
                            '23502', // not_null_violation
                            '08006', // connection_failure
                            '08003', // connection_does_not_exist
                            '53300', // too_many_connections
                        ]);

                        if (STRUCTURAL_PG_CODES.has(error?.code) || errorMsg.includes('ON CONFLICT')) {
                            this.logger.error(`Fatal SQL error for ${tableName}. Aborting batch.`, error, { tableName, realmId });
                            throw error;
                        }

                        this.logger.warn(`Batch ${batchNum} failed for ${tableName}. Executing throttled single-row fallback.`, {
                            tableName,
                            realmId,
                            error: errorMsg
                        });

                        const fallbackCount = await this.executeIndividualFallback(
                            client,
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

    private async executeRawBatchQuery<T extends Record<string, any>>(
        client: any,
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
            const hasSyncToken = columns.includes('syncToken');

            query += hasSyncToken
                ? ` WHERE "${tableName}"."updatedAt" < EXCLUDED."updatedAt"` +
                ` OR ("${tableName}"."updatedAt" = EXCLUDED."updatedAt" AND "${tableName}"."syncToken"::int < EXCLUDED."syncToken"::int)` +
                ` OR "${tableName}"."updatedAt" IS NULL`
                : ` WHERE "${tableName}"."updatedAt" < EXCLUDED."updatedAt"` +
                ` OR "${tableName}"."updatedAt" IS NULL`;
        }

        // FIX 5.1 C1: Return actual affected row count instead of assumed batch length
        const affected = await client.$executeRawUnsafe(query, ...values);
        return affected;
    }

    private async executeIndividualFallback<T extends Record<string, any>>(
        client: any,
        tableName: string,
        columns: string[],
        quotedColumns: string,
        quotedConflictTargets: string,
        updateSet: string | null,
        batch: T[],
        realmId: string
    ): Promise<number> {
        let saved = 0;
        let errorCount = 0;

        for (const singleRecord of batch) {
            try {
                const count = await this.executeRawBatchQuery(
                    client,
                    tableName,
                    columns,
                    quotedColumns,
                    quotedConflictTargets,
                    updateSet,
                    [singleRecord]
                );
                saved += count;
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