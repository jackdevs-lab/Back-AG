// core/normalize/bill-payment.ts
import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';
import { RawTransaction, RawRuleConfig, RawVendor, RawSyncLog } from '../data/types';
import { createHash } from 'crypto';

/**
 * STRICT_MODE enables .strict() in development to surface unknown fields immediately.
 * This prevents silent schema drift from QuickBooks API changes (the original
 * .passthrough() masked them). In production we use the default "strip" behavior
 * so parsing remains resilient while still validating the fields we care about.
 */
const STRICT_MODE = process.env.NODE_ENV === 'development';

export const LinkedTxnSchema = z.object({
    TxnId: z.string().optional(),
    TxnType: z.string().optional()
});

export const LineSchema = z.object({
    LinkedTxn: z.array(LinkedTxnSchema).optional()
});

const billPaymentRawBase = z.object({
    DocNumber: z.string().optional(),
    PrivateNote: z.string().optional(),
    Line: z.array(LineSchema).optional(),
    CurrencyRef: z.object({ value: z.string().optional() }).optional(),
    ExchangeRate: z.number().optional(),
    status: z.string().optional(),
    MetaInfo: z.object({ Status: z.string().optional() }).optional()
});

export const BillPaymentRawSchema = STRICT_MODE
    ? billPaymentRawBase.strict()
    : billPaymentRawBase; // default = strip (unknown fields removed)

export type ParsedBillPaymentRaw = z.infer<typeof BillPaymentRawSchema>;

export type ParseResult<T> =
    | { success: true; data: T }
    | { success: false; error: z.ZodError };

export function parseBillPaymentRaw(rawData: unknown): ParseResult<ParsedBillPaymentRaw> {
    const result = BillPaymentRawSchema.safeParse(rawData);
    return result.success
        ? { success: true, data: result.data }
        : { success: false, error: result.error };
}

/**
 * Sanitized subset of Zod issues – exactly the field-level diagnostics
 * requested for observability/debugging.
 */
export type ZodIssueSummary = Pick<z.ZodIssue, 'path' | 'message'>;

export interface NormalizedRuleConfig {
    amountThreshold: Prisma.Decimal;
    defaultExchangeRates: Record<string, number>;
}

const DEFAULT_THRESHOLD = 10000;

export function normalizeRuleConfig(raw: RawRuleConfig): NormalizedRuleConfig {
    if (!raw?.json) {
        return {
            amountThreshold: new Prisma.Decimal(DEFAULT_THRESHOLD),
            defaultExchangeRates: {}
        };
    }

    const parsed = raw.json as Record<string, unknown>;
    const threshold = typeof parsed.amountThreshold === 'number'
        ? new Prisma.Decimal(parsed.amountThreshold)
        : new Prisma.Decimal(DEFAULT_THRESHOLD);

    const rates = parsed.defaultExchangeRates && typeof parsed.defaultExchangeRates === 'object' && parsed.defaultExchangeRates !== null
        ? parsed.defaultExchangeRates as Record<string, number>
        : {};

    return {
        amountThreshold: threshold,
        defaultExchangeRates: rates
    };
}

export interface NormalizedSyncStatus {
    entityType: string;
    lastSuccessAt: Date | null;
    isStale: boolean;
}

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export function normalizeSyncStatus(
    logs: (RawSyncLog | null)[],
    entityTypes: string[],
    now: Date
): NormalizedSyncStatus[] {
    return entityTypes.map((entity, idx) => {
        const log = logs[idx];
        const lastSuccessAt = log?.createdAt ?? null;
        const isStale = lastSuccessAt
            ? (now.getTime() - lastSuccessAt.getTime()) > STALE_THRESHOLD_MS
            : true;

        return { entityType: entity, lastSuccessAt, isStale };
    });
}

export function generateCompositeSnapshotId(syncLogs: (RawSyncLog | null)[]): string {
    const snapshotIds = syncLogs
        .filter((s): s is RawSyncLog => s !== null)
        .map(s => s.id)
        .sort();

    return snapshotIds.length > 0
        ? createHash('sha256').update(snapshotIds.join(':')).digest('hex').slice(0, 16)
        : 'manual_trigger';
}

export interface NormalizedBillPayment {
    id: string;
    qbId: string;
    date: Date;
    amount: Prisma.Decimal;
    vendorId: string | null;
    createdAt: Date | null;
    parsedRaw: ParsedBillPaymentRaw | null;
    parseFailed: boolean;
    parseError?: ZodIssueSummary[]; // field-level diagnostics (no longer a flat string)
}

export function normalizeBillPayment(raw: RawTransaction): NormalizedBillPayment {
    // Enforce non-empty qbId at runtime (as requested)
    z.string().min(1, { message: 'qbId must be a non-empty string' }).parse(raw.qbId);

    const result = parseBillPaymentRaw(raw.rawData);

    return {
        id: raw.id,
        qbId: raw.qbId,
        date: raw.date,
        amount: new Prisma.Decimal(raw.amount ?? 0),
        vendorId: raw.vendorId,
        createdAt: raw.createdAt,
        parsedRaw: result.success ? result.data : null,
        parseFailed: !result.success,
        parseError: result.success
            ? undefined
            : result.error.issues.map(({ path, message }) => ({ path, message }))
    };
}

export interface NormalizedVendor {
    qbId: string;
    name: string;
    active: boolean;
}

export function normalizeVendor(raw: RawVendor): NormalizedVendor {
    // Enforce non-empty qbId at runtime (as requested)
    z.string().min(1, { message: 'qbId must be a non-empty string' }).parse(raw.qbId);

    return {
        qbId: raw.qbId,
        name: raw.name,
        active: raw.active
    };
}
