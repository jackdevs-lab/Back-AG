import { BrandedRepository, RealmId } from '@qb-health/financial-model';
import { fetchRuleConfig, transactionGenerator } from '../shared/data-primitives';

export { fetchRuleConfig };

export interface FetchBillsParams {
    realmId: RealmId;
    lookbackDate?: Date;
    pageSize?: number;
}

/**
 * Generator for memory-safe batch processing of Bills for multiple bills detection.
 */
export async function* getBillsGenerator(
    repo: BrandedRepository,
    params: FetchBillsParams
) {
    yield* transactionGenerator(repo, {
        realmId: params.realmId,
        type: 'Bill',
        lookbackDate: params.lookbackDate,
        hasStatusColumn: false,
        pageSize: params.pageSize ?? 1000
    });
}
