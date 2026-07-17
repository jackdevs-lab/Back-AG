import { Prisma } from '@qb-health/financial-model';
import { RawSyncLog, RawRuleConfig, RawTransaction, RawVendor, FetchSyncLogsParams, FetchTransactionsParams, FetchVendorsParams } from './types';
export declare function fetchSyncLogs(prisma: any, params: FetchSyncLogsParams): Promise<(RawSyncLog | null)[]>;
export declare function checkTransactionSchemaHasColumn(prisma: any, columnName: string): Promise<{
    column_name: string;
}[]>;
export declare function fetchRuleConfig(prisma: any, realmId: string, ruleId: string): Promise<RawRuleConfig>;
export declare function fetchBillPayments(prisma: any, params: FetchTransactionsParams): Promise<RawTransaction[]>;
/**
 * Grouped candidate search for duplicate bill payment detection.
 */
export declare function fetchDuplicateBillPaymentCandidates(prisma: any, params: {
    realmId: string;
    lookbackDate: Date;
}): Promise<any[]>;
export declare function fetchVendorsByQbIds(prisma: any, params: FetchVendorsParams): Promise<RawVendor[]>;
