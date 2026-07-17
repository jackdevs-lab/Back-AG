import { BrandedRepository, RealmId, QbId } from '@qb-health/financial-model';
import { fetchRuleConfig, transactionGenerator, fetchTransactionsByQbIds } from '../shared/data-primitives';

export { fetchRuleConfig };

export interface FetchBillPaymentsParams {
    realmId: RealmId;
    lookbackDate?: Date;
    pageSize?: number;
}

/**
 * Generator for memory-safe batch processing of BillPayments for orphaned detection.
 */
export async function* getBillPaymentsGenerator(
    repo: BrandedRepository,
    params: FetchBillPaymentsParams
) {
    yield* transactionGenerator(repo, {
        realmId: params.realmId,
        type: 'BillPayment',
        lookbackDate: params.lookbackDate,
        hasStatusColumn: false,
        pageSize: params.pageSize ?? 1000
    });
}

/**
 * Fetches Bills matching specific QBO IDs.
 */
export async function fetchBillsByIds(
    repo: BrandedRepository,
    realmId: RealmId,
    qbIds: QbId[]
) {
    if (qbIds.length === 0) return [];

    return fetchTransactionsByQbIds(repo, {
        realmId,
        qbIds,
        types: ['Bill']
    });
}
