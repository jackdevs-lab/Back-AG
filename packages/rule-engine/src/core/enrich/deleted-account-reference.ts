import * as crypto from 'crypto';

export function generateFingerprint(txnId: string, accountId: string): string {
    return crypto.createHash('sha256')
        .update(`${txnId}|DELETED_ACCOUNT|${accountId}`)
        .digest('hex');
}


export function calculateImpactScore(): number {
    return 80;
}
