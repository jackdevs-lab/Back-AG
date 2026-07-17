// core/enrich/je-without-name.ts
import * as crypto from 'crypto';

/**
 * Generates a stable fingerprint for a JE line missing a name.
 */
export function generateFingerprint(id: string, linesCount: number): string {
    return crypto.createHash('sha256')
        .update(`${id}|NO_NAME|${linesCount}`)
        .digest('hex');
}

/**
 * Calculates impact score for missing categorical data.
 */
export function calculateImpactScore(linesCount: number): number {
    return Math.min(100, 15 * linesCount);
}
