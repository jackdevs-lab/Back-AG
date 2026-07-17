import { BrandedRepository, RealmId } from '@qb-health/financial-model';
import { fetchRuleConfig, transactionGenerator } from '../shared/data-primitives';

export { fetchRuleConfig };

export interface FetchTemporalDataParams {
    realmId: RealmId;
    lookbackDate?: Date;
    pageSize?: number;
}

/**
 * Generator for memory-safe batch processing of Bills and BillPayments.
 */
export async function* getBillsAndPaymentsGenerator(
    repo: BrandedRepository,
    params: FetchTemporalDataParams
) {
    yield* transactionGenerator(repo, {
        realmId: params.realmId,
        type: ['Bill', 'BillPayment'],
        lookbackDate: params.lookbackDate,
        hasStatusColumn: false,
        pageSize: params.pageSize ?? 1000
    });
}
