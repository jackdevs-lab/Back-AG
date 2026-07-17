// core/data/bill-rule.ts
import { Prisma } from '@qb-health/financial-model';
import { 
    RawTransaction, 
    FetchTransactionsParams 
} from './types';

/**
 * Fetches Bills from the database with standard AP filters.
 * Implements cursor-based pagination for memory safety.
 */
export async function fetchBills(
    prisma: any,
    params: FetchTransactionsParams
): Promise<RawTransaction[]> {
    const { realmId, type, lookbackDate, hasStatusColumn, pageSize, cursor } = params;

    const transactions = await prisma.transaction.findMany({
        where: {
            realmId,
            type: 'Bill',
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

    // Integrity Check: Validate amount precision/type
    for (const tx of transactions) {
        if (
            tx.amount !== null &&
            typeof tx.amount !== 'number' &&
            !(tx.amount instanceof Prisma.Decimal)
        ) {
            throw new Error(
                `[fetchBills] Invalid amount type for transaction ${tx.id}: ` +
                `expected Prisma.Decimal | number | null, got ${typeof tx.amount}`
            );
        }
    }

    return transactions;
}

/**
 * Grouped candidate search for duplicate detection.
 * Uses Prisma's groupBy to identify potential duplicates before full record load.
 */
export async function fetchDuplicateBillCandidates(
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
            type: 'Bill',
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
