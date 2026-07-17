// core/shared/data-primitives.ts
import { BrandedRepository, RealmId, RuleId, QbId } from '@qb-health/financial-model';
import { Prisma } from '@qb-health/financial-model';
import { z } from 'zod';

export async function fetchRuleConfig(repo: BrandedRepository, realmId: RealmId, ruleId: RuleId) {
    return repo.findRuleConfig(realmId, ruleId);
}

export async function fetchSyncLogs(repo: BrandedRepository, params: { realmId: RealmId; entityTypes: string[] }) {
    return repo.findSyncLogs(params);
}

export async function fetchTransactions(
    repo: BrandedRepository,
    params: {
        realmId: RealmId;
        type: string;
        lookbackDate?: Date;
        hasStatusColumn?: boolean;
        pageSize?: number;
        cursor?: { date: Date; id: string };
    }
) {
    return repo.findTransactions(params);
}

export async function fetchVendorsByQbIds(repo: BrandedRepository, params: { realmId: RealmId; vendorQbIds: QbId[] }) {
    return repo.findVendorsByQbIds(params);
}

export async function fetchCustomersByQbIds(repo: BrandedRepository, params: { realmId: RealmId; customerQbIds: QbId[] }) {
    return repo.findCustomersByQbIds(params);
}

export async function fetchAccountsByType(repo: BrandedRepository, params: { realmId: RealmId; type: string }) {
    return repo.findAccountsByType(params);
}

export async function aggregateTransactionSum(repo: BrandedRepository, params: { realmId: RealmId; type: string; status?: string; jsonPath: string }) {
    return repo.aggregateTransactionSum(params);
}

export function normalizeTransactionBatch<
    T extends z.ZodTypeAny,
    I extends Record<string, any> = any
>(
    batch: I[],
    schema: T
): { normalized: Array<I & { qboData: z.infer<T> }>; unscannable: any[] } {

    const normalized: Array<I & { qboData: z.infer<T> }> = [];
    const unscannable: any[] = [];

    for (const item of batch) {
        try {
            const parsed = schema.parse(item.rawData);
            normalized.push({ ...item, qboData: parsed });
        } catch (err) {
            unscannable.push({
                qbId: item.qbId,
                type: item.type,
                error: err instanceof Error ? err.message : 'Validation failed',
                rawData: item.rawData
            });
        }
    }

    return { normalized, unscannable };
}

export async function* transactionGenerator(
    repo: BrandedRepository,
    params: {
        realmId: RealmId;
        type: string | string[];
        pageSize?: number;
        lookbackDate?: Date;
        hasStatusColumn?: boolean;
    }
): AsyncGenerator<any[]> {
    yield* repo.streamTransactions(params);
}

export async function fetchAccounts(
    repo: BrandedRepository,
    params: {
        realmId: RealmId;
        active?: boolean;
    }
) {
    return repo.findAccounts(params);
}

export async function fetchTransactionsByQbIds(
    repo: BrandedRepository,
    params: {
        realmId: RealmId;
        qbIds: QbId[];
        types?: string[];
    }
) {
    return repo.findTransactionsByQbIds(params);
}

export async function fetchTransactionQbIds(
    repo: BrandedRepository,
    params: {
        realmId: RealmId;
        excludeStatus?: string[];
    }
) {
    return repo.findTransactionQbIds(params);
}

export async function fetchCustomers(
    repo: BrandedRepository,
    params: {
        realmId: RealmId;
        active?: boolean;
    }
) {
    return repo.findCustomers(params);
}