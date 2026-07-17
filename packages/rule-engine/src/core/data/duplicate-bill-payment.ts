import { BrandedRepository, RealmId } from '@qb-health/financial-model';
import { fetchRuleConfig, transactionGenerator } from '../shared/data-primitives';

export { fetchRuleConfig };

export interface FetchBillPaymentsParams {
    realmId: RealmId;
    lookbackDate?: Date;
    pageSize?: number;
}

/**
 * Generator for memory-safe batch processing of BillPayments for duplicate detection.
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
