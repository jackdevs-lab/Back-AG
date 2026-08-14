import { BrandedRepository, RealmId, RuleId } from '@qb-health/financial-model';
import {
    transactionGenerator
} from '../shared/data-primitives';

export async function fetchRuleConfig(repo: BrandedRepository, tenantId: string, realmId: RealmId, ruleId: RuleId) {
    return repo.findRuleConfig(tenantId, realmId, ruleId);
}

export function getFutureDateBillsGenerator(
    repo: BrandedRepository,
    params: {
        realmId: RealmId;
        pageSize?: number;
    }
) {
    return transactionGenerator(repo, {
        realmId: params.realmId,
        type: 'Bill',
        pageSize: params.pageSize ?? 1000,
        hasStatusColumn: false
    });
}
