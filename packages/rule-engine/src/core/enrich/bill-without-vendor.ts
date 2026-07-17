import Decimal from 'decimal.js';
import { getScoringConfig, ScoringConfig } from './config/scoring-rules';
import { NormalizedBill } from '../normalize/bill-without-vendor';
import { generateFingerprint } from '../shared/utils';

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
        const amount = bill.amount.toNumber();
        const fingerprint = generateFingerprint([bill.qbId || 'unknown']);
        const impactScore = calculateImpactScore(amount);

        return {
            qbId: bill.qbId || 'unknown',
            amount: amount,
            currency: bill.currency,
            date: bill.date,
            fingerprint,
            impactScore,
            entities: [{
                id: bill.qbId,
                type: 'Bill',
                amount: amount,
                currency: bill.currency,
                date: bill.date
            }],
            metadata: {
                impactScore,
                fingerprint,
                snapshotTimestamp
            }
        };
    });
}
