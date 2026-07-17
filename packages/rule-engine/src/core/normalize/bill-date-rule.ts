// core/normalize/bill-date-rule.ts
import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';
import { RawBillRecord } from '../data/bill-date-rule';

// ============================================================================
// CONFIGURATION SCHEMA & NORMALIZATION
// ============================================================================

export const BillDateRuleConfigSchema = z.object({
    allowedFutureDays: z.number().nonnegative().default(0),
    severityThresholds: z.object({
        warning: z.number().default(0),
        error: z.number().default(10000)
    }).default({ warning: 0, error: 10000 }),
    stalenessPolicy: z.enum(['warn', 'block']).default('warn')
}).default({
    allowedFutureDays: 0,
    severityThresholds: { warning: 0, error: 10000 },
    stalenessPolicy: 'warn'
});

export type BillDateRuleConfig = z.infer<typeof BillDateRuleConfigSchema>;

/**
 * Parses and validates raw config JSON into typed configuration object.
 * Handles missing/invalid fields with safe defaults.
 */
export function normalizeRuleConfig(raw: unknown): BillDateRuleConfig {
    return BillDateRuleConfigSchema.parse(raw ?? {});
}

// ============================================================================
// BILL RAW DATA SCHEMA & NORMALIZATION
// ============================================================================

export const BillRawSchema = z.object({
    VendorRef: z.object({
        name: z.string().optional(),
        value: z.string().optional()
    }).optional(),
    CurrencyRef: z.object({
        value: z.string().optional()
    }).optional(),
    SyncToken: z.string().optional().default("0").transform(v => parseInt(v, 10))
}).passthrough();

export type ParsedBillRawData = z.infer<typeof BillRawSchema>;

/**
 * Safely parses bill rawData from QuickBooks API response.
 * Returns null if parsing fails - caller handles gracefully.
 */
export function normalizeBillRawData(rawData: unknown): ParsedBillRawData | null {
    const result = BillRawSchema.safeParse(rawData);
    return result.success ? result.data : null;
}

// ============================================================================
// CONNECTION NORMALIZATION
// ============================================================================

export interface NormalizedConnection {
    timezone: string;
    lastSyncAt: Date;
}

/**
 * Normalizes raw connection record into typed, validated object.
 * Returns null if required fields (timezone) are missing.
 */
export function normalizeConnection(raw: unknown): NormalizedConnection | null {
    if (!raw || typeof raw !== 'object') return null;
    const conn = raw as Record<string, unknown>;
    const timezone = conn.timezone as string | undefined;
    const lastSyncAt = conn.lastSyncAt as Date | undefined;

    if (!timezone) return null;

    return {
        timezone,
        lastSyncAt: lastSyncAt || new Date()
    };
}

// ============================================================================
// BILL RECORD NORMALIZATION
// ============================================================================

export interface NormalizedBill {
    id: string;
    qbId: string;
    date: Date;
    amount: Prisma.Decimal;
    syncToken: string;
    parsedRawData: ParsedBillRawData | null;
}

/**
 * Transforms raw database record into typed, enriched bill object.
 * Handles decimal conversion and rawData parsing in one step.
 */
export function normalizeBillRecord(raw: RawBillRecord): NormalizedBill {
    return {
        id: raw.id,
        qbId: raw.qbId,
        date: raw.date,
        amount: new Prisma.Decimal((raw.amount as any) ?? 0),
        syncToken: raw.syncToken,
        parsedRawData: normalizeBillRawData(raw.rawData)
    };
}
