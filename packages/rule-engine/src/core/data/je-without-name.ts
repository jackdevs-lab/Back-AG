// core/data/je-without-name.ts
import { BrandedRepository, RealmId } from '@qb-health/financial-model';
import { fetchRuleConfig, fetchTransactions, fetchSyncLogs } from '../shared/data-primitives';

export { fetchRuleConfig, fetchSyncLogs };

/**
 * Fetches all Journal Entries for name verification.
 */
export async function fetchJournalEntries(repo: BrandedRepository, realmId: RealmId) {
    return fetchTransactions(repo, {
        realmId,
        type: 'JournalEntry',
        pageSize: 10000
    });
}
