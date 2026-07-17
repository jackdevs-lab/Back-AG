import Decimal from 'decimal.js';
import { getScoringConfig, ScoringConfig } from './config/scoring-rules';
import { NormalizedBill } from '../normalize/bill-date-in-future';
import { generateFingerprint } from '../shared/utils';

export interface EnrichmentMetadata {
    amountSource: 'exact' | 'estimated' | 'fallback';
    fallbackReason?: string;
    calculatedAt: string;
    configVersion: string;
    warnings?: string[];
    status: 'SUCCESS' | 'SKIPPED_NEGATIVE' | 'MISSING_AMOUNT' | 'INVALID_AMOUNT';
}

export interface EnrichedFinding {
    qbId: string;
    amount: number;
    currency: string;
    date: Date;
    fingerprint: string;
    impactScore: number;
    entities: any[];
    metadata: {
        impactScore: number;
        fingerprint: string;
        [key: string]: any;
    };
}

export class EnrichmentError extends Error {
    constructor(message: string, public code: string, public field?: string) {
        super(message);
        this.name = 'EnrichmentError';
    }
}

export function calculateImpactScore(
    amount: number,
    configOverride?: Partial<ScoringConfig>
): number {
    const config = { ...getScoringConfig(), ...configOverride };

    if (amount < 0 && !config.allowNegativeAmounts) {
        return 0;
    }

    const stepSize = new Decimal(config.amountThresholdStep);
    const multiplier = new Decimal(config.baseScoreMultiplier);
    const absAmount = new Decimal(Math.abs(amount));

    const steps = absAmount.dividedToIntegerBy(stepSize);
    const cappedSteps = steps.minus(config.maxSteps).isPositive()
        ? config.maxSteps
        : steps.toNumber();

    let rawScore = multiplier.times(cappedSteps).toNumber();

    if (rawScore > config.maxScore) {
        rawScore = config.maxScore;
    }

    return Math.round(rawScore);
}

export function enrichBillFindings(
    bills: NormalizedBill[],
    snapshotTimestamp: string
): EnrichedFinding[] {
    return bills.map(bill => {
        const decimalAmount = bill.amount;
        const displayAmount = decimalAmount.toNumber();
        const fingerprint = generateFingerprint([
            bill.qbId || 'unknown',
            decimalAmount.toString()
        ]);

        const impactScore = calculateImpactScore(displayAmount);

        return {
            qbId: bill.qbId || 'unknown',
            amount: displayAmount,
            decimalAmount: decimalAmount,
            currency: bill.currency,
            date: bill.date,
            fingerprint,
            impactScore,
            entities: [{
                id: bill.qbId,
                type: 'Bill',
                amount: displayAmount,
                currency: bill.currency,
                date: bill.date,
                preciseAmount: decimalAmount.toString()
            }],
            metadata: {
                impactScore,
                fingerprint,
                snapshotTimestamp,
                preciseAmount: decimalAmount.toString()
            }
        };
    });
}
