// core/detect/is-unlinked-payment.ts
import { ParsedBillPaymentRaw } from '../normalize/bill-payment';

// Suggestion 1: Tri-state enum to explicitly handle and flag unknowns
export enum LinkageStatus {
    UNLINKED = 'UNLINKED',
    LINKED = 'LINKED',
    UNKNOWN = 'UNKNOWN'
}

/**
 * Pure detection function: determines linkage status of a bill payment.
 * * ZERO side effects:
 * - No database calls
 * - No logging
 * - No I/O operations
 * - No external dependencies beyond parsed input
 */
export function getLinkageStatus(
    parsedRaw: ParsedBillPaymentRaw | null,
    schemaVersion: number = 3 // Defaults to older schema where TxnType is required
): LinkageStatus {
    // Fix: Explicitly return UNKNOWN instead of false to prevent masking data quality issues
    if (!parsedRaw) return LinkageStatus.UNKNOWN;

    // If no Line array exists, payment has no links by definition
    if (!parsedRaw.Line || !Array.isArray(parsedRaw.Line) || parsedRaw.Line.length === 0) {
        return LinkageStatus.UNLINKED;
    }

    const hasBillLink = parsedRaw.Line.some(line =>
        line.LinkedTxn?.some(link => {
            // Standard check
            if (link.TxnType === 'Bill') return true;

            // Suggestion 2: Schema version check to prevent false positives when TxnType is missing
            // Assuming version 4+ makes TxnType optional; we verify linkage via the presence of a TxnId
            if (!link.TxnType && schemaVersion >= 4 && link.TxnId) {
                return true;
            }

            return false;
        })
    );

    return hasBillLink ? LinkageStatus.LINKED : LinkageStatus.UNLINKED;
}

/**
 * Pure filter function: applies grace period.
 * * Suggestion 3: Status filtering (Voided/Deleted) is now centralized in the data layer. 
 * This detection layer only handles time-based sync lag checks.
 */
export function passesGracePeriod(
    payment: {
        createdAt: Date | null;
    },
    nowMs: number,
    gracePeriodMs: number
): boolean {
    const ingestionTimeMs = payment.createdAt?.getTime() ?? nowMs;
    return (nowMs - ingestionTimeMs) >= gracePeriodMs;
}

/**
 * Batch variant: filters array of normalized payments.
 * Now cleanly orchestrates the tri-state enum and updated pre-filters.
 */
export function filterUnlinkedPayments(
    payments: Array<{
        createdAt: Date | null;
        parsedRaw: ParsedBillPaymentRaw | null;
    }>,
    nowMs: number,
    gracePeriodMs: number,
    schemaVersion: number = 3
): Array<{ createdAt: Date | null; parsedRaw: ParsedBillPaymentRaw | null }> {
    return payments.filter(payment => {
        if (!passesGracePeriod(payment, nowMs, gracePeriodMs)) {
            return false;
        }

        const status = getLinkageStatus(payment.parsedRaw, schemaVersion);

        // Note: UNKNOWN statuses are filtered out here for standard downstream processing, 
        // but the orchestrator calling getLinkageStatus directly can now catch them for manual review.
        return status === LinkageStatus.UNLINKED;
    });
}
