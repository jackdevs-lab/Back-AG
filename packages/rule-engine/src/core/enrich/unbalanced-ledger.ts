// core/enrich/unbalanced-ledger.ts
import * as crypto from 'crypto';

/**
 * Generates a stable fingerprint for an unbalanced journal entry.
 */
export function generateFingerprint(id: string, variance: number): string {
    return crypto.createHash('sha256')
        .update(`${id}|UNBALANCED|${variance.toFixed(2)}`)
        .digest('hex');
}

/**
 * Calculates impact score based on the variance magnitude.
 */
export function calculateImpactScore(variance: number): number {
    return Math.min(100, Math.round(50 * Math.min(2, variance / 1000)));
}
