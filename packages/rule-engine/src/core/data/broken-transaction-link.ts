// core/data/broken-transaction-link.ts
import { fetchRuleConfig, fetchTransactions, fetchSyncLogs } from '../shared/data-primitives';

export { fetchRuleConfig, fetchSyncLogs };

const MEANINGFUL_TYPES = ['CreditMemo', 'Invoice', 'Bill', 'Deposit', 'Payment', 'BillPayment'];

/**
 * Fetches all transaction IDs for cross-reference.
 */
export async function fetchAllQbIds(prisma: any, realmId: string) {
    const ids = await prisma.transaction.findMany({
        where: { realmId },
        select: { qbId: true }
    });
    return new Set(ids.map((t: any) => t.qbId));
}

/**
 * Fetches transactions that are likely to have linked references.
 */
export async function fetchTransactionsWithLinks(prisma: any, realmId: string) {
    return prisma.transaction.findMany({
        where: { 
            realmId,
            type: { in: MEANINGFUL_TYPES }
        },
        select: { qbId: true, type: true, date: true, rawData: true }
    });
}
