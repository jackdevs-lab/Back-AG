// core/data/bill-payment-rule.ts
import { Prisma } from '@qb-health/financial-model';


import { 
    RawSyncLog, 
    RawRuleConfig, 
    RawTransaction, 
    RawVendor, 
    FetchSyncLogsParams, 
    FetchTransactionsParams, 
    FetchVendorsParams 
} from './types';


export async function fetchSyncLogs(
    prisma: any,
    params: FetchSyncLogsParams
): Promise<(RawSyncLog | null)[]> {
    const { realmId, entityTypes } = params;

    return Promise.all(
        entityTypes.map(entity =>
            prisma.syncLog.findFirst({
                where: { realmId, entityType: entity, status: 'SUCCESS' },
                orderBy: { createdAt: 'desc' }
            }) as Promise<RawSyncLog | null>
        )
    );
}


export async function checkTransactionSchemaHasColumn(
    prisma: any,
    columnName: string
): Promise<{ column_name: string }[]> {
    return prisma.$queryRaw`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'Transaction' AND table_schema = 'public' AND column_name = ${columnName}
  ` as Promise<{ column_name: string }[]>;
}


export async function fetchRuleConfig(
    prisma: any,
    realmId: string,
    ruleId: string
): Promise<RawRuleConfig> {
    return prisma.ruleConfig.findUnique({
        where: { realmId_ruleId: { realmId, ruleId } }
    }) as Promise<RawRuleConfig>;
}

export async function fetchBillPayments(
    prisma: any,
    params: FetchTransactionsParams
): Promise<RawTransaction[]> {
    const { realmId, type, lookbackDate, hasStatusColumn, pageSize, cursor } = params;

    const transactions = await prisma.transaction.findMany({
        where: {
            realmId,
            type,
            date: { gte: lookbackDate },
            ...(hasStatusColumn ? { status: { notIn: ['Voided', 'Deleted'] } } : {})
        },
        take: pageSize,
        cursor,
        orderBy: { id: 'asc' },
        select: {
            id: true,
            qbId: true,
            date: true,
            amount: true,
            rawData: true,
            vendorId: true,
            createdAt: true
        }
    }) as RawTransaction[];

    for (const tx of transactions) {
        if (
            tx.amount !== null &&
            typeof tx.amount !== 'number' &&
            !(tx.amount instanceof Prisma.Decimal)
        ) {
            throw new Error(
                `Invalid amount type for transaction ${tx.id}: ` +
                `expected Prisma.Decimal | number | null, got ${typeof tx.amount}`
            );
        }
    }

    return transactions;
}

/**
 * Grouped candidate search for duplicate bill payment detection.
 */
export async function fetchDuplicateBillPaymentCandidates(
    prisma: any,
    params: {
        realmId: string;
        lookbackDate: Date;
    }
): Promise<any[]> {
    const { realmId, lookbackDate } = params;

    return (prisma.transaction as any).groupBy({
        by: ['vendorId', 'amount', 'date'],
        where: {
            realmId,
            type: 'BillPayment',
            OR: [
                { status: { notIn: ['Voided', 'Deleted'] } },
                { status: { equals: null } }
            ],
            date: { gte: lookbackDate }
        },
        _count: { qbId: true },
        having: { qbId: { _count: { gt: 1 } } }
    });
}

export async function fetchVendorsByQbIds(
    prisma: any,
    params: FetchVendorsParams
): Promise<RawVendor[]> {
    const { realmId, vendorQbIds } = params;

    return prisma.vendor.findMany({
        where: { realmId, qbId: { in: vendorQbIds }, active: true },
        select: { qbId: true, name: true, active: true }
    }) as Promise<RawVendor[]>;
}
