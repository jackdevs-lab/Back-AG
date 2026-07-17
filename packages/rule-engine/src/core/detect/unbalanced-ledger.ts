// core/detect/unbalanced-ledger.ts

/**
 * Detects if a journal entry is unbalanced beyond a given tolerance.
 */
export function isUnbalanced(variance: any, tolerance: any): boolean {
    return variance.gt(tolerance);
}
