// core/enrich/ap-control-account-mismatch.ts
import * as crypto from 'crypto';
export function generateFingerprint(realmId: string, ruleId: string, variance: number): string {
    return crypto.createHash('sha256')
        .update(`${realmId}|${ruleId}|${variance.toFixed(0)}`)
        .digest('hex');
}

export function calculateImpactScore(variance: number): number {
    return Math.min(100, Math.round(50 * Math.min(2, variance / 5000)));
}
