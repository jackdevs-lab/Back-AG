import * as crypto from 'crypto';
export function generateFingerprint(ids: string[]): string {
    const sortedIds = [...ids].sort();
    return crypto.createHash('sha256')
        .update(sortedIds.join('|'))
        .digest('hex');
}
