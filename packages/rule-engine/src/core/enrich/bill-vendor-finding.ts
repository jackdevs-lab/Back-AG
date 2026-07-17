// core/enrich/bill-vendor-finding.ts
import { Prisma } from '@qb-health/financial-model';
import * as crypto from 'crypto';
import { NormalizedBill, RuleConfigData } from '../normalize/bill-vendor';
import { ParsedBillRaw } from '../normalize/bill';
import { Severity } from '../../types';

// ============================================================================
// ENRICHED FINDING TYPE
// ============================================================================

export interface EnrichedBillFinding {
    id: string;
    amount: number;
    date: Date;
    auditMetadata: {
        timestamp: string;
        qbId: string;
        dataSnapshotTimestamp: string;
        qboLastModified: string | null;
        ruleVersion: string;
        configHash: string;
    };
}

// ============================================================================
// VENDOR & CURRENCY ENRICHMENT
// ============================================================================

export interface BillDisplayInfo {
    vendorName: string;
    currency: string;
    formattedAmount: string;
}

/**
 * Extracts display-ready vendor/currency info from parsed bill data.
 * Provides safe defaults for missing optional fields.
 */
export function enrichBillDisplayInfo(
    bill: NormalizedBill,
    homeCurrency: string
): BillDisplayInfo {
    if (!bill.parsedRaw) {
        return {
            vendorName: 'Unassigned',
            currency: homeCurrency,
            formattedAmount: bill.amount.toFixed(2)
        };
    }

    const vendorName = bill.parsedRaw.VendorRef?.name || 'Unassigned';
    const currency = bill.parsedRaw.CurrencyRef?.value || homeCurrency;
    const formattedAmount = bill.amount.toFixed(2);

    return { vendorName, currency, formattedAmount };
}

/**
 * Formats date with timezone-aware locale formatting.
 * Graceful fallback if timezone is invalid.
 */
export function formatBillDate(date: Date, timezone: string): string {
    try {
        return date.toLocaleDateString('en-US', {
            timeZone: timezone,
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    } catch {
        return date.toLocaleDateString('en-US');
    }
}

// ============================================================================
// IDENTIFIER & AUDIT ENRICHMENT
// ============================================================================

/**
 * Generates deterministic finding instance ID with config hash for traceability.
 */
export function generateFindingInstanceId(
    ruleId: string,
    realmId: string,
    qbId: string,
    syncBatchId: string | undefined
): string {
    const rawStr = `${ruleId}:${realmId}:${qbId}:${syncBatchId || 'manual-run'}`;
    return crypto.createHash('sha256').update(rawStr).digest('hex');
}

/**
 * Computes config hash for audit trail and cache invalidation.
 */
export function computeConfigHash(config: RuleConfigData): string {
    return crypto.createHash('sha256')
        .update(JSON.stringify(config))
        .digest('hex');
}

/**
 * Extracts QBO last modified timestamp from parsed rawData.
 */
export function extractQboLastModified(parsedRaw: ParsedBillRaw | null): string | null {
    return parsedRaw?.MetaData?.LastUpdatedTime || null;
}

// ============================================================================
// SEVERITY CALCULATION
// ============================================================================

export interface SeverityResult {
    issueSeverity: Severity;
    resultStatus: 'ERROR' | 'WARNING';
}

/**
 * Determines final severity based on count AND amount thresholds.
 * Uses Decimal-safe comparison to avoid floating-point errors.
 * Priority: CRITICAL > HIGH > default WARNING.
 */
export function calculateSeverity(
    totalCount: number,
    totalAmount: Prisma.Decimal,
    thresholds: {
        criticalCount: number;
        criticalAmount: number;
        highCount: number;
        highAmount: number;
    },
    defaultSeverity: Severity
): SeverityResult {
    const isCritical = totalCount >= thresholds.criticalCount || totalAmount.gte(thresholds.criticalAmount);
    const isHigh = totalCount >= thresholds.highCount || totalAmount.gte(thresholds.highAmount);

    const issueSeverity: Severity = isCritical ? 'CRITICAL' : isHigh ? 'HIGH' : defaultSeverity;
    const resultStatus = issueSeverity === 'CRITICAL' ? 'ERROR' : 'WARNING';

    return { issueSeverity, resultStatus };
}

// ============================================================================
// AGGREGATION HELPERS
// ============================================================================

/**
 * Calculates precise total amount across bills using Prisma.Decimal.
 * Avoids floating-point accumulation errors.
 */
export function calculateTotalAmount(bills: NormalizedBill[]): Prisma.Decimal {
    return bills.reduce(
        (sum, b) => sum.add(b.amount),
        new Prisma.Decimal(0)
    );
}

// ============================================================================
// COMPOSITE ENRICHMENT
// ============================================================================

/**
 * Creates fully enriched finding from normalized bill and context.
 * Orchestrates all enrichment steps into single, reusable function.
 */
export function createEnrichedFinding(
    bill: NormalizedBill,
    ruleId: string,
    realmId: string,
    syncBatchId: string | undefined,
    freshnessDate: string,
    ruleVersion: string,
    configHash: string,
    now: Date = new Date()
): EnrichedBillFinding {
    const findingId = generateFindingInstanceId(ruleId, realmId, bill.qbId, syncBatchId);
    const qboLastModified = extractQboLastModified(bill.parsedRaw);

    return {
        id: findingId,
        amount: bill.amount.toNumber(),
        date: bill.date,
        auditMetadata: {
            timestamp: now.toISOString(),
            qbId: bill.qbId,
            dataSnapshotTimestamp: freshnessDate,
            qboLastModified,
            ruleVersion,
            configHash
        }
    };
}
