import Decimal from 'decimal.js';
import { getScoringConfig, ScoringConfig } from './config/scoring-rules';
import { NormalizedTransaction } from '../normalize/expense-instead-of-bill-payment';
import { generateFingerprint } from '../shared/utils';

export interface EnrichedMatchFinding {
    fingerprint: string;
    impactScore: number;
    bill: NormalizedTransaction;
    purchase: NormalizedTransaction;
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

export function enrichMatchFindings(
    matches: { bill: NormalizedTransaction; purchase: NormalizedTransaction }[],
    snapshotTimestamp: string
): EnrichedMatchFinding[] {
    return matches.map(match => {
        const amount = match.bill.amount.toNumber();
        const fingerprint = generateFingerprint([match.bill.qbId!, match.purchase.qbId!]);
        const impactScore = calculateImpactScore(amount);

        return {
            fingerprint,
            impactScore,
            bill: match.bill,
            purchase: match.purchase,
            entities: [
                {
                    id: match.bill.qbId,
                    type: 'Bill',
                    amount: amount,
                    currency: match.bill.currency,
                    date: match.bill.date
                },
                {
                    id: match.purchase.qbId,
                    type: 'Purchase',
                    amount: match.purchase.amount.toNumber(),
                    currency: match.purchase.currency,
                    date: match.purchase.date
                }
            ],
            metadata: {
                impactScore,
                fingerprint,
                snapshotTimestamp
            }
        };
    });
}
