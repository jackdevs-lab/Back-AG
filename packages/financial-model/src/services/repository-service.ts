// packages/financial-model/src/services/repository-service.ts
//
// This file is the single authorised boundary between branded domain types and
// the raw-string Prisma client.  Every `as string` / `as unknown as string`
// cast in the codebase lives here — nowhere else.
//
import { PrismaClient, Prisma } from '@prisma/client';
import {
    RealmId,
    RuleId,
    QbId,
    QbConnection,
    RuleConfig,
    BrandedSyncStatus,
} from '../entities';

// ---------------------------------------------------------------------------
// Interface — what callers see (branded types only, no Prisma leakage)
// ---------------------------------------------------------------------------

export interface TransactionQueryParams {
    realmId: RealmId;
    type: string | string[];
    lookbackDate?: Date;
    hasStatusColumn?: boolean;
    pageSize?: number;
    cursor?: { date: Date; id: string };
}

export interface AggregateTransactionSumParams {
    realmId: RealmId;
    type: string;
    status?: string;
    jsonPath: string;
}

export interface BrandedRepository {
    // Connection status
    updateQbConnectionStatus(
        tenantId: string,
        realmId: RealmId,
        status: BrandedSyncStatus,
        lastSyncAt?: Date
    ): Promise<QbConnection>;

    findQbConnectionByRealmId(
        tenantId: string,
        realmId: RealmId
    ): Promise<QbConnection | null>;

    // Rule config
    findRuleConfig(realmId: RealmId, ruleId: RuleId): Promise<RuleConfig | null>;

    // Sync logs
    findSyncLogs(params: { realmId: RealmId; entityTypes: string[] }): Promise<any[]>;

    // Transactions
    findTransactions(params: TransactionQueryParams): Promise<any[]>;
    streamTransactions(
        params: Omit<TransactionQueryParams, 'cursor' | 'pageSize'> & { pageSize?: number }
    ): AsyncGenerator<any[]>;

    // Reference data
    findVendorsByQbIds(params: { realmId: RealmId; vendorQbIds: QbId[] }): Promise<any[]>;
    findCustomersByQbIds(params: { realmId: RealmId; customerQbIds: QbId[] }): Promise<any[]>;
    findAccountsByType(params: { realmId: RealmId; type: string }): Promise<any[]>;
    findAccounts(params: { realmId: RealmId; active?: boolean }): Promise<any[]>;

    // Filtered entity queries (used by hygiene rules that bypass the pipeline)
    findCustomers(params: { realmId: RealmId; active?: boolean }): Promise<any[]>;
    findVendors(params: { realmId: RealmId; active?: boolean }): Promise<any[]>;
    countTransactionsByType(params: { realmId: RealmId; type: string | string[] }): Promise<number>;

    // Transactions queries by QbId
    findTransactionsByQbIds(params: { realmId: RealmId; qbIds: QbId[]; types?: string[] }): Promise<any[]>;
    findTransactionQbIds(params: { realmId: RealmId; excludeStatus?: string[] }): Promise<QbId[]>;

    // Aggregates
    aggregateTransactionSum(params: AggregateTransactionSumParams): Promise<Prisma.Decimal>;
}

// ---------------------------------------------------------------------------
// Implementation — Prisma casts are confined here
// ---------------------------------------------------------------------------

export class PrismaBrandedRepository implements BrandedRepository {
    constructor(private readonly prismaClient: PrismaClient) { }

    // ---- Connection status -------------------------------------------------

    async updateQbConnectionStatus(
        tenantId: string,
        realmId: RealmId,
        status: BrandedSyncStatus,
        lastSyncAt?: Date
    ): Promise<QbConnection> {
        return this.prismaClient.qbConnection.update({
            where: {
                tenantId_realmId: {
                    tenantId: tenantId,
                    realmId: realmId as string
                }
            },
            data: {
                syncStatus: status as unknown as string,
                ...(lastSyncAt !== undefined && { lastSyncAt }),
            },
        }) as unknown as QbConnection;
    }

    async findQbConnectionByRealmId(tenantId: string, realmId: RealmId): Promise<QbConnection | null> {
        const result = await this.prismaClient.qbConnection.findUnique({
            where: {
                tenantId_realmId: {
                    tenantId: tenantId,
                    realmId: realmId as string
                }
            },
        });
        return result as unknown as QbConnection | null;
    }

    // ---- Rule config -------------------------------------------------------

    async findRuleConfig(realmId: RealmId, ruleId: RuleId): Promise<RuleConfig | null> {
        return this.prismaClient.ruleConfig.findUnique({
            where: { realmId_ruleId: { realmId: realmId as string, ruleId: ruleId as string } },
        }) as unknown as RuleConfig | null;
    }

    // ---- Sync logs ---------------------------------------------------------

    async findSyncLogs(params: { realmId: RealmId; entityTypes: string[] }): Promise<any[]> {
        return this.prismaClient.syncLog.findMany({
            where: {
                realmId: params.realmId as string,
                entityType: { in: params.entityTypes },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
        });
    }

    // ---- Transactions (single page) ----------------------------------------

    async findTransactions(params: TransactionQueryParams): Promise<any[]> {
        const where: any = {
            realmId: params.realmId as string,
            type: Array.isArray(params.type) ? { in: params.type } : params.type,
        };

        if (params.lookbackDate) {
            where.date = { gte: params.lookbackDate };
        }

        if (params.hasStatusColumn) {
            where.status = { not: 'Voided' };
        }

        const query: any = {
            where,
            select: {
                id: true,
                qbId: true,
                date: true,
                amount: true,
                rawData: true,
                customerId: true,
                vendorId: true,
                type: true,
            },
            orderBy: [{ date: 'desc' }, { id: 'desc' }],
            take: params.pageSize ?? 5000,
        };

        if (params.cursor) {
            query.cursor = { date_id: params.cursor };
            query.skip = 1;
        }

        return this.prismaClient.transaction.findMany(query);
    }

    // ---- Transactions (async generator / streaming) ------------------------

    async *streamTransactions(
        params: Omit<TransactionQueryParams, 'cursor' | 'pageSize'> & { pageSize?: number }
    ): AsyncGenerator<any[]> {
        const pageSize = params.pageSize ?? 1000;
        let cursor: { date: Date; id: string } | undefined;

        while (true) {
            const query: any = {
                where: {
                    realmId: params.realmId as string,
                    type: Array.isArray(params.type) ? { in: params.type } : params.type,
                    ...(params.lookbackDate ? { date: { gte: params.lookbackDate } } : {}),
                    ...(params.hasStatusColumn
                        ? { status: { notIn: ['Voided', 'Deleted'] } }
                        : {}),
                },
                take: pageSize,
                orderBy: [{ date: 'asc' }, { id: 'asc' }],
                select: {
                    id: true,
                    qbId: true,
                    date: true,
                    amount: true,
                    rawData: true,
                    vendorId: true,
                    customerId: true,
                    syncToken: true,
                    type: true,
                },
            };

            if (cursor) {
                query.cursor = { date_id: cursor };
                query.skip = 1;
            }

            const batch = await this.prismaClient.transaction.findMany(query);

            if (batch.length === 0) break;

            yield batch;

            if (batch.length < pageSize) break;

            const last = batch[batch.length - 1];
            cursor = { date: last.date, id: last.id };
        }
    }

    // ---- Reference data ----------------------------------------------------

    async findCustomers(params: { realmId: RealmId; active?: boolean }): Promise<any[]> {
        const where: any = { realmId: params.realmId as string };
        if (params.active !== undefined) where.active = params.active;
        return this.prismaClient.customer.findMany({
            where,
            select: { qbId: true, name: true, balance: true },
        });
    }

    async findVendors(params: { realmId: RealmId; active?: boolean }): Promise<any[]> {
        const where: any = { realmId: params.realmId as string };
        if (params.active !== undefined) where.active = params.active;
        return this.prismaClient.vendor.findMany({
            where,
            select: { qbId: true, name: true },
        });
    }

    async countTransactionsByType(params: { realmId: RealmId; type: string | string[] }): Promise<number> {
        return this.prismaClient.transaction.count({
            where: {
                realmId: params.realmId as string,
                type: Array.isArray(params.type) ? { in: params.type } : params.type,
            },
        });
    }

    async findVendorsByQbIds(params: { realmId: RealmId; vendorQbIds: QbId[] }): Promise<any[]> {
        return this.prismaClient.vendor.findMany({
            where: {
                realmId: params.realmId as string,
                qbId: { in: params.vendorQbIds as unknown as string[] },
            },
            select: { qbId: true, name: true },
        });
    }

    async findCustomersByQbIds(params: {
        realmId: RealmId;
        customerQbIds: QbId[];
    }): Promise<any[]> {
        return this.prismaClient.customer.findMany({
            where: {
                realmId: params.realmId as string,
                qbId: { in: params.customerQbIds as unknown as string[] },
            },
            select: { qbId: true, name: true },
        });
    }

    async findAccountsByType(params: { realmId: RealmId; type: string }): Promise<any[]> {
        return this.prismaClient.account.findMany({
            where: { realmId: params.realmId as string, type: params.type },
            select: { qbId: true, name: true, balance: true },
        });
    }

    async findAccounts(params: { realmId: RealmId; active?: boolean }): Promise<any[]> {
        const where: any = { realmId: params.realmId as string };
        if (params.active !== undefined) {
            where.active = params.active;
        }
        return this.prismaClient.account.findMany({
            where,
            select: { qbId: true, name: true, type: true, balance: true },
        });
    }

    async findTransactionsByQbIds(params: { realmId: RealmId; qbIds: QbId[]; types?: string[] }): Promise<any[]> {
        const where: any = {
            realmId: params.realmId as string,
            qbId: { in: params.qbIds as unknown as string[] },
        };
        if (params.types) {
            where.type = { in: params.types };
        }
        return this.prismaClient.transaction.findMany({
            where,
            select: { qbId: true, type: true, date: true, amount: true, rawData: true, customerId: true, vendorId: true },
        });
    }

    async findTransactionQbIds(params: { realmId: RealmId; excludeStatus?: string[] }): Promise<QbId[]> {
        const where: any = { realmId: params.realmId as string };
        if (params.excludeStatus) {
            where.status = { notIn: params.excludeStatus };
        }
        const records = await this.prismaClient.transaction.findMany({
            where,
            select: { qbId: true },
        });
        return records.map(r => r.qbId as unknown as QbId);
    }


    // ---- Aggregates --------------------------------------------------------

    async aggregateTransactionSum(
        params: AggregateTransactionSumParams
    ): Promise<Prisma.Decimal> {
        const statusClause = params.status
            ? Prisma.sql`AND "status" = ${params.status}`
            : Prisma.empty;

        const result = await this.prismaClient.$queryRaw<[{ total: number | null }]>`
            SELECT SUM(( "rawData"->>${params.jsonPath} )::numeric) as total
            FROM "Transaction"
            WHERE "realmId" = ${params.realmId as string}
            AND "type" = ${params.type}
            ${statusClause}
        `;

        return new Prisma.Decimal(result[0]?.total || 0);
    }
}
