// core/normalize/bill-vendor.ts
import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';
import { RawRuleConfig, RawSyncLog, RawBillRecord } from '../data/bill-vendor-rule';

// ============================================================================
// RULE CONFIGURATION SCHEMA & NORMALIZATION
// ============================================================================

export const ConfigSchema = z.object({
    criticalCount: z.number().min(1).default(100),
    criticalAmount: z.number().min(0).default(100000),
    highCount: z.number().min(1).default(25),
    highAmount: z.number().min(0).default(25000),
    lookbackDays: z.number().min(30).max(2555).default(730),
    currencyCode: z.string().length(3).default('USD'),
    timezone: z.string().default('UTC')
});

export type RuleConfigData = z.infer<typeof ConfigSchema>;

export interface NormalizedThresholds {
    criticalCount: number;
    criticalAmount: number;
    highCount: number;
    highAmount: number;
    lookbackDays: number;
}

/**
 * Parses and validates rule configuration with safe defaults.
 * Extracts threshold subset for detection logic.
 */
export function normalizeRuleConfig(raw: RawRuleConfig): {
    config: RuleConfigData;
    thresholds: NormalizedThresholds;
    homeCurrency: string;
    timezone: string;
} {
    const config = ConfigSchema.parse(raw?.json || {});

    return {
        config,
        thresholds: {
            criticalCount: config.criticalCount,
            criticalAmount: config.criticalAmount,
            highCount: config.highCount,
            highAmount: config.highAmount,
            lookbackDays: config.lookbackDays
        },
        homeCurrency: config.currencyCode,
        timezone: config.timezone
    };
}

// ============================================================================
// BILL RAW DATA SCHEMA & NORMALIZATION
// ============================================================================

export const BillRawSchema = z.object({
    VendorRef: z.object({
        name: z.string().optional()
    }).optional(),
    CurrencyRef: z.object({
        value: z.string().optional()
    }).optional(),
    MetaData: z.object({
        LastUpdatedTime: z.string().optional()
    }).optional()
}).passthrough();

export type ParsedBillRaw = z.infer<typeof BillRawSchema>;

/**
 * Safely parses bill rawData from QuickBooks API response.
 * Returns null on parse failure - caller handles gracefully.
 */
export function parseBillRaw(rawData: unknown): ParsedBillRaw | null {
    const result = BillRawSchema.safeParse(rawData);
    return result.success ? result.data : null;
}

// ============================================================================
// SYNC LOG NORMALIZATION
// ============================================================================

export interface NormalizedSyncStatus {
    syncBatchId: string | undefined;
    lastSyncAt: Date | undefined;
    isHealthy: boolean;
    freshnessDate: string;
}

/**
 * Normalizes raw sync log into typed status object.
 * Calculates health flag and formatted freshness date.
 */
export function normalizeSyncStatus(raw: RawSyncLog): NormalizedSyncStatus {
    if (!raw) {
        return {
            syncBatchId: undefined,
            lastSyncAt: undefined,
            isHealthy: false,
            freshnessDate: 'Unknown'
        };
    }

    return {
        syncBatchId: raw.id,
        lastSyncAt: raw.createdAt,
        isHealthy: raw.status === 'COMPLETED',
        freshnessDate: raw.createdAt.toISOString()
    };
}

// ============================================================================
// BILL RECORD NORMALIZATION
// ============================================================================

export interface NormalizedBill {
    qbId: string;
    date: Date;
    amount: Prisma.Decimal;
    parsedRaw: ParsedBillRaw | null;
    parseFailed: boolean;
}

/**
 * Transforms raw bill record into typed, parsed object.
 * Handles decimal conversion and rawData parsing with error tracking.
 */
export function normalizeBillRecord(raw: RawBillRecord): NormalizedBill {
    const parsedRaw = parseBillRaw(raw.rawData);

    return {
        qbId: raw.qbId,
        date: raw.date,
        amount: new Prisma.Decimal((raw.amount as any) ?? 0),
        parsedRaw,
        parseFailed: parsedRaw === null
    };
}

/**
 * Batch normalization helper for efficiency.
 */
export function normalizeBillRecords(raws: RawBillRecord[]): NormalizedBill[] {
    return raws.map(normalizeBillRecord);
}
