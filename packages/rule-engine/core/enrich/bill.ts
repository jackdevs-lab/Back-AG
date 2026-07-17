// core/enrich/bill-finding.ts
import { Prisma } from '@qb-health/financial-model';
import { createHash } from 'crypto';
import { NormalizedBill, BillDateRuleConfig } from '../normalize/bill-date-rule';

// ============================================================================
// ENRICHED FINDING TYPE
// ============================================================================

export interface EnrichedBillFinding {
    id: string;
    findingId: string;
    amount: string;
    date: Date;
    vendorName: string;
    currency: string;
    auditMetadata: {
        snapshotTimestamp: string;
        executedAt: string;
        syncToken: string;
        ruleVersion: number;
        isStaleReference: boolean;
    };
}

// ============================================================================
// VENDOR & CURRENCY ENRICHMENT
// ============================================================================

/**
 * Extracts and normalizes vendor/currency info from parsed bill data.
 * Provides safe defaults for missing optional fields.
 */
export function enrichBillWithVendorInfo(bill: NormalizedBill): {
    vendorName: string;
    currency: string;
} {
    const vendorName = bill.parsedRawData?.VendorRef?.name || 'Unknown Vendor';
    const currency = bill.parsedRawData?.CurrencyRef?.value || 'USD';
    return { vendorName, currency };
}

/**
 * Formats amount with currency-aware decimal precision.
 * Handles special cases like JPY (0 decimals) vs USD (2 decimals).
 */
export function formatAmount(amount: Prisma.Decimal, currency: string): string {
    const decimalPlaces = currency === 'JPY' ? 0 : 2;
    return amount.toFixed(decimalPlaces);
}

// ============================================================================
// IDENTIFIER & AUDIT ENRICHMENT
// ============================================================================

/**
 * Generates deterministic, collision-resistant finding ID.
 * Uses SHA-256 hash of composite key for traceability.
 */
export function generateFindingId(
    realmId: string,
    ruleId: string,
    qbId: string,
    date: Date
): string {
    const dateOnly = date.toISOString().split('T')[0];
    return createHash('sha256')
        .update(`${realmId}:${ruleId}:${qbId}:${dateOnly}`)
        .digest('hex');
}

/**
 * Constructs audit metadata object with execution context.
 * Enables forensic tracing and replayability of findings.
 */
export function addAuditMetadata(
    bill: NormalizedBill,
    snapshotTimestamp: string,
    ruleVersion: number,
    isStale: boolean
): EnrichedBillFinding['auditMetadata'] {
    return {
        snapshotTimestamp,
        executedAt: new Date().toISOString(),
        syncToken: bill.syncToken,
        ruleVersion,
        isStaleReference: isStale
    };
}

// ============================================================================
// SEVERITY CALCULATION
// ============================================================================

export interface SeverityResult {
    isEscalated: boolean;
    finalSeverity: 'CRITICAL' | 'WARNING';
    finalStatus: 'ERROR' | 'WARNING';
}

/**
 * Determines final severity based on amount thresholds.
 * Uses Decimal-safe comparison to avoid floating-point errors.
 */
export function calculateSeverity(
    bills: NormalizedBill[],
    thresholds: BillDateRuleConfig['severityThresholds']
): SeverityResult {
    let maxAmount = new Prisma.Decimal(0);
    for (const bill of bills) {
        if (bill.amount.gt(maxAmount)) {
            maxAmount = bill.amount;
        }
    }

    const errorThreshold = new Prisma.Decimal(thresholds.error);
    const isEscalated = maxAmount.gte(errorThreshold);

    return {
        isEscalated,
        finalSeverity: isEscalated ? 'CRITICAL' : 'WARNING',
        finalStatus: isEscalated ? 'ERROR' : 'WARNING'
    };
}

// ============================================================================
// COMPOSITE ENRICHMENT
// ============================================================================

/**
 * Creates fully enriched finding object from normalized bill.
 * Orchestrates all enrichment steps into single, reusable function.
 */
export function createEnrichedFinding(
    realmId: string,
    ruleId: string,
    bill: NormalizedBill,
    snapshotTimestamp: string,
    ruleVersion: number,
    isStale: boolean
): EnrichedBillFinding {
    const { vendorName, currency } = enrichBillWithVendorInfo(bill);
    const formattedAmount = formatAmount(bill.amount, currency);
    const findingId = generateFindingId(realmId, ruleId, bill.qbId, bill.date);
    const auditMetadata = addAuditMetadata(bill, snapshotTimestamp, ruleVersion, isStale);

    return {
        id: bill.qbId,
        findingId,
        amount: formattedAmount,
        date: bill.date,
        vendorName,
        currency,
        auditMetadata
    };
}