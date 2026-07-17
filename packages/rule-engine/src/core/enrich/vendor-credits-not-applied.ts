// core/enrich/vendor-credits-not-applied.ts
import * as crypto from 'crypto';

interface ImpactScoreConfig {
    baseThreshold: number;
    multiplier: number;
    maxScore: number;
    maxAmountThreshold: number;
}

const DEFAULT_CONFIG: ImpactScoreConfig = {
    baseThreshold: 1000,
    multiplier: 30,
    maxScore: 100,
    maxAmountThreshold: 2000
};

export function generateFingerprint(vendorId: string, qbId: string, dateKey: string): string {
    if (!vendorId || !qbId || !dateKey) {
        throw new Error('All parameters required for fingerprint generation');
    }
    return crypto.createHash('sha256').update(`${vendorId}|${qbId}|${dateKey}`).digest('hex');
}

export function calculateImpactScore(
    amount: number,
    config: ImpactScoreConfig = DEFAULT_CONFIG
): { score: number; isEstimated: boolean; confidence: 'high' | 'medium' | 'low' } {
    if (typeof amount !== 'number' || isNaN(amount)) throw new Error('Amount must be a valid number');

    if (amount < 0) {
        console.warn(`Negative amount detected: ${amount}. Setting to 0 for calculation.`);
        amount = 0;
    }

    const normalizedAmount = Math.min(config.maxAmountThreshold, amount);
    const rawScore = (config.multiplier * normalizedAmount) / config.baseThreshold;
    const clampedScore = Math.min(config.maxScore, Math.round(rawScore));

    let confidence: 'high' | 'medium' | 'low' = 'high';
    let isEstimated = false;

    if (amount > config.maxAmountThreshold) {
        isEstimated = true;
        confidence = 'medium';
    } else if (amount === 0) {
        confidence = 'low';
    } else if (rawScore > config.maxScore) {
        isEstimated = true;
        confidence = 'medium';
    }

    return { score: clampedScore, isEstimated, confidence };
}
