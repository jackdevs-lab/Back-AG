// core/data/ap-control-account-mismatch.ts
import { Prisma, BrandedRepository, RealmId } from '@qb-health/financial-model';
import { fetchRuleConfig, fetchSyncLogs, fetchAccountsByType, aggregateTransactionSum, fetchTransactions } from '../shared/data-primitives';

export { fetchRuleConfig, fetchSyncLogs };

/**
 * Calculates current liability from Open Vendor Bills using DB aggregation.
 */
export async function fetchBillSubledgerTotal(repo: BrandedRepository, realmId: RealmId): Promise<Prisma.Decimal> {
    return aggregateTransactionSum(repo, {
        realmId,
        type: 'Bill',
        status: 'Open',
        jsonPath: 'Balance'
    });
}

/**
 * Fetches all AP control accounts.
 */
export async function fetchApAccounts(repo: BrandedRepository, realmId: RealmId) {
    return fetchAccountsByType(repo, {
        realmId,
        type: 'Accounts Payable'
    });
}

/**
 * Forensic: Fetches Journal Entries for potential direct-to-account posting analysis.
 */
export async function fetchJournalEntries(repo: BrandedRepository, realmId: RealmId) {
    return fetchTransactions(repo, {
        realmId,
        type: 'JournalEntry',
        pageSize: 100
    });
}
