// core/data/bill-vendor-rule.ts
import { Prisma } from '@qb-health/financial-model';

// ============================================================================
// TYPE DEFINITIONS FOR RAW DATA ACCESS
// ============================================================================

export type RawRuleConfig = {
    json: Record<string, unknown> | null;
} | null;

export type RawSyncLog = {
    id: string;
    realmId: string;
    status: string;
    createdAt: Date;
} | null;

export type RawBillRecord = {
    qbId: string;
    date: Date;
    amount: unknown;
    rawData: unknown;
};

export interface FetchRuleConfigParams {
    realmId: string;
    ruleId: string;
}

export interface FetchSyncLogParams {
    realmId: string;
}

export interface FetchBillsParams {
    realmId: string;
    lookbackDate: Date;
    limit: number;
}

export interface CountBillsParams {
    realmId: string;
    lookbackDate: Date;
}

// ============================================================================
// DATA ACCESS FUNCTIONS (NO BUSINESS LOGIC)
// ============================================================================

/**
 * Fetches rule configuration JSON from database.
 * Pure data access - no parsing or validation.
 */
export async function fetchRuleConfig(
    prisma: any,
    params: FetchRuleConfigParams
): Promise<RawRuleConfig> {
    const { realmId, ruleId } = params;

    return prisma.ruleConfig.findUnique({
        where: { realmId_ruleId: { realmId, ruleId } }
    }) as Promise<RawRuleConfig>;
}

/**
 * Fetches latest sync log for a realm to assess data freshness.
 * Returns raw record - normalization handles typing.
 */
export async function fetchLatestSyncLog(
    prisma: any,
    params: FetchSyncLogParams
): Promise<RawSyncLog> {
    const { realmId } = params;

    return prisma.syncLog.findFirst({
        where: { realmId },
        orderBy: { createdAt: 'desc' }
    }) as Promise<RawSyncLog>;
}

/**
 * Fetches bills missing vendor reference within lookback window.
 * Applies core filters: type='Bill', vendorId=null, status in ['Posted','Paid'].
 * Returns raw records - normalization handles parsing.
 */
export async function fetchBillsWithoutVendor(
    prisma: any,
    params: FetchBillsParams
): Promise<RawBillRecord[]> {
    const { realmId, lookbackDate, limit } = params;

    return prisma.transaction.findMany({
        where: {
            realmId,
            type: 'Bill',
            vendorId: null,
            date: { gte: lookbackDate },
            status: { in: ['Posted', 'Paid'] }
        },
        take: limit,
        select: { qbId: true, date: true, amount: true, rawData: true }
    }) as Promise<RawBillRecord[]>;
}

/**
 * Counts total bills matching the missing-vendor criteria.
 * Used for severity calculation and reporting.
 */
export async function countBillsWithoutVendor(
    prisma: any,
    params: CountBillsParams
): Promise<number> {
    const { realmId, lookbackDate } = params;

    return prisma.transaction.count({
        where: {
            realmId,
            type: 'Bill',
            vendorId: null,
            date: { gte: lookbackDate },
            status: { in: ['Posted', 'Paid'] }
        }
    });
}
