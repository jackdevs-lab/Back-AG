import * as crypto from 'crypto';
export function generateFingerprint(sourceId: string, targetId: string): string {
    return crypto.createHash('sha256')
        .update(`${sourceId}|BROKEN|${targetId}`)
        .digest('hex');
}

export function calculateImpactScore(): number {
    return 30;
}
