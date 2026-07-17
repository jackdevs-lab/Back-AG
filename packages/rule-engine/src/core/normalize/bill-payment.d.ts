import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';
import { RawTransaction, RawRuleConfig, RawVendor, RawSyncLog } from '../data/types';
export declare const LinkedTxnSchema: z.ZodObject<{
    TxnId: z.ZodOptional<z.ZodString>;
    TxnType: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const LineSchema: z.ZodObject<{
    LinkedTxn: z.ZodOptional<z.ZodArray<z.ZodObject<{
        TxnId: z.ZodOptional<z.ZodString>;
        TxnType: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const BillPaymentRawSchema: z.ZodObject<{
    Line: z.ZodOptional<z.ZodArray<z.ZodObject<{
        LinkedTxn: z.ZodOptional<z.ZodArray<z.ZodObject<{
            TxnId: z.ZodOptional<z.ZodString>;
            TxnType: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
    }, z.core.$strip>>>;
    CurrencyRef: z.ZodOptional<z.ZodObject<{
        value: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    ExchangeRate: z.ZodOptional<z.ZodNumber>;
    status: z.ZodOptional<z.ZodString>;
    MetaInfo: z.ZodOptional<z.ZodObject<{
        Status: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type ParsedBillPaymentRaw = z.infer<typeof BillPaymentRawSchema>;
export type ParseResult<T> = {
    success: true;
    data: T;
} | {
    success: false;
    error: z.ZodError;
};
export declare function parseBillPaymentRaw(rawData: unknown): ParseResult<ParsedBillPaymentRaw>;
/**
 * Sanitized subset of Zod issues – exactly the field-level diagnostics
 * requested for observability/debugging.
 */
export type ZodIssueSummary = Pick<z.ZodIssue, 'path' | 'message'>;
export interface NormalizedRuleConfig {
    amountThreshold: Prisma.Decimal;
    defaultExchangeRates: Record<string, number>;
}
export declare function normalizeRuleConfig(raw: RawRuleConfig): NormalizedRuleConfig;
export interface NormalizedSyncStatus {
    entityType: string;
    lastSuccessAt: Date | null;
    isStale: boolean;
}
export declare function normalizeSyncStatus(logs: (RawSyncLog | null)[], entityTypes: string[], now: Date): NormalizedSyncStatus[];
export declare function generateCompositeSnapshotId(syncLogs: (RawSyncLog | null)[]): string;
export interface NormalizedBillPayment {
    id: string;
    qbId: string;
    date: Date;
    amount: Prisma.Decimal;
    vendorId: string | null;
    createdAt: Date | null;
    parsedRaw: ParsedBillPaymentRaw | null;
    parseFailed: boolean;
    parseError?: ZodIssueSummary[];
}
export declare function normalizeBillPayment(raw: RawTransaction): NormalizedBillPayment;
export interface NormalizedVendor {
    qbId: string;
    name: string;
    active: boolean;
}
export declare function normalizeVendor(raw: RawVendor): NormalizedVendor;
