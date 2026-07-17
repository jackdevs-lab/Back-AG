// core/data/ar-control-account-mismatch.ts
import { BrandedRepository, RealmId } from '@qb-health/financial-model';
import { fetchRuleConfig, fetchSyncLogs, fetchAccountsByType, fetchTransactions } from '../shared/data-primitives';

export { fetchRuleConfig, fetchSyncLogs };

/**
 * Calculates current customer sub-ledger total.
 */
export async function fetchCustomerBalanceTotal(repo: BrandedRepository, realmId: RealmId) {
    const customers = await repo.findCustomers({ realmId });
    let sum = 0;
    for (const c of customers) {
        sum += typeof c.balance?.toNumber === 'function' ? c.balance.toNumber() : Number(c.balance || 0);
    }
    return {
        sum,
        count: customers.length
    };
}

/**
 * Fetches all AR control accounts.
 */
export async function fetchArAccounts(repo: BrandedRepository, realmId: RealmId) {
    return fetchAccountsByType(repo, {
        realmId,
        type: 'Accounts Receivable'
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

/**
 * Fetches top customers for context in reporting.
 */
export async function fetchSignificantCustomers(repo: BrandedRepository, realmId: RealmId) {
    const customers = await repo.findCustomers({ realmId });
    return customers
        .filter(c => {
            const val = typeof c.balance?.toNumber === 'function' ? c.balance.toNumber() : Number(c.balance || 0);
            return val !== 0;
        })
        .sort((a, b) => {
            const valA = typeof a.balance?.toNumber === 'function' ? a.balance.toNumber() : Number(a.balance || 0);
            const valB = typeof b.balance?.toNumber === 'function' ? b.balance.toNumber() : Number(b.balance || 0);
            return valB - valA;
        })
        .slice(0, 10)
        .map(c => ({
            name: c.name,
            balance: c.balance
        }));
}
