import { BrandedRepository, RealmId } from '@qb-health/financial-model';
import { fetchRuleConfig, transactionGenerator } from '../shared/data-primitives';

export { fetchRuleConfig };

export interface FetchTemporalDataParams {
    realmId: RealmId;
    lookbackDate?: Date;
    pageSize?: number;
}

/**
 * Generator for memory-safe batch processing of Bills and Purchases.
 */
export async function* getBillsAndPurchasesGenerator(
    repo: BrandedRepository,
    params: FetchTemporalDataParams
) {
    yield* transactionGenerator(repo, {
        realmId: params.realmId,
        type: ['Bill', 'Purchase'],
        lookbackDate: params.lookbackDate,
        hasStatusColumn: false,
        pageSize: params.pageSize ?? 1000
    });
}
