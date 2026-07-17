// core/data/deleted-account-reference.ts
import { fetchRuleConfig, fetchSyncLogs } from '../shared/data-primitives';

export { fetchRuleConfig, fetchSyncLogs };

/**
 * Fetches all active account IDs for cross-reference.
 */
export async function fetchValidAccountIds(prisma: any, realmId: string) {
    const accounts = await prisma.account.findMany({
        where: { realmId },
        select: { qbId: true }
    });
    return new Set(accounts.map((a: any) => a.qbId));
}

/**
 * Fetches transactions that are likely to have account references.
 */
export async function fetchTransactionsWithAccountRefs(prisma: any, realmId: string) {
    return prisma.transaction.findMany({
        where: { 
            realmId,
            type: { in: ['JournalEntry', 'Bill', 'Expense', 'Deposit', 'Check', 'CreditCardCredit', 'CreditCardCharge'] }
        },
        select: { qbId: true, type: true, date: true, rawData: true }
    });
}
