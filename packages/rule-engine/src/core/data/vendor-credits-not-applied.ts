import { BrandedRepository, RealmId } from '@qb-health/financial-model';
import { fetchRuleConfig, transactionGenerator } from '../shared/data-primitives';

export { fetchRuleConfig };

export interface FetchVendorCreditsParams {
    realmId: RealmId;
    lookbackDate?: Date;
    pageSize?: number;
}

/**
 * Generator for memory-safe batch processing of VendorCredits.
 */
export async function* getVendorCreditsGenerator(
    repo: BrandedRepository,
    params: FetchVendorCreditsParams
) {
    yield* transactionGenerator(repo, {
        realmId: params.realmId,
        type: 'VendorCredit',
        lookbackDate: params.lookbackDate,
        hasStatusColumn: false,
        pageSize: params.pageSize ?? 1000
    });
}
