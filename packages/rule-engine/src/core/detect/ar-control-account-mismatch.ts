// core/detect/ar-control-account-mismatch.ts

/**
 * Detects if a variance exists between sub-ledger and GL control accounts.
 */
export function isMismatch(variance: any, tolerance: any): boolean {
    return variance.gt(tolerance);
}
