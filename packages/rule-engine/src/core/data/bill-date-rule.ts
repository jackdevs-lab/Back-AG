// core/data/bill-date-rule.ts
import { Prisma } from '@qb-health/financial-model';

/**
 * Fetches QuickBooks connection record for a realm.
 * Returns raw/untyped result - normalization handled separately.
 */
export async function getQbConnection(
    prisma: any,
    realmId: string
): Promise<unknown> {
    return prisma.qbConnection.findUnique({ where: { realmId } });
}

/**
 * Fetches raw JSON config for a rule from the database.
 * No parsing or validation performed here.
 */
export async function getRuleConfigJson(
    prisma: any,
    realmId: string,
    ruleId: string
): Promise<unknown> {
    const raw = await prisma.ruleConfig?.findUnique({
        where: { realmId_ruleId: { realmId, ruleId } },
        select: { json: true }
    });
    return raw?.json ?? {};
}

/**
 * Query parameters for fetching future-dated bills.
 */
export interface FetchBillsQueryParams {
    realmId: string;
    maxAllowedUTC: Date;
    batchSize: number;
    cursor?: { id: string };
}

/**
 * Raw bill record shape from Prisma select.
 * Amount and rawData are untyped - normalization handles parsing.
 */
export type RawBillRecord = {
    id: string;
    qbId: string;
    date: Date;
    amount: unknown;
    rawData: unknown;
    syncToken: string;
};

/**
 * Fetches bills that match the future-date filter criteria.
 * Pure data access - no business logic, filtering, or transformation.
 */
export async function fetchFutureDatedBills(
    prisma: any,
    params: FetchBillsQueryParams
): Promise<RawBillRecord[]> {
    const { realmId, maxAllowedUTC, batchSize, cursor } = params;

    return prisma.transaction.findMany({
        where: {
            realmId,
            type: 'Bill',
            date: { gte: maxAllowedUTC },
            status: { notIn: ['Void', 'Deleted'] }
        },
        select: {
            id: true,
            qbId: true,
            date: true,
            amount: true,
            rawData: true,
            syncToken: true
        },
        take: batchSize,
        orderBy: [
            { date: 'asc' },
            { id: 'asc' }
        ],
        cursor,
    }) as Promise<RawBillRecord[]>;
}
