import Decimal from 'decimal.js';
import { getScoringConfig, ScoringConfig } from './config/scoring-rules';
import { NormalizedTransaction } from '../normalize/payment-before-bill';
import { generateFingerprint } from '../shared/utils';

export interface EnrichedAnomalyFinding {
    fingerprint: string;
    impactScore: number;
    payment: NormalizedTransaction;
    bill: NormalizedTransaction;
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

export function enrichAnomalyFindings(
    anomalies: { payment: NormalizedTransaction; bill: NormalizedTransaction }[],
    snapshotTimestamp: string
): EnrichedAnomalyFinding[] {
    return anomalies.map(anomaly => {
        const amount = anomaly.payment.amount.toNumber();
        const fingerprint = generateFingerprint([anomaly.payment.qbId!, anomaly.bill.qbId!]);
        const impactScore = calculateImpactScore(amount);

        return {
            fingerprint,
            impactScore,
            payment: anomaly.payment,
            bill: anomaly.bill,
            entities: [
                {
                    id: anomaly.payment.qbId,
                    type: 'BillPayment',
                    amount: amount,
                    currency: anomaly.payment.currency,
                    date: anomaly.payment.date
                },
                {
                    id: anomaly.bill.qbId,
                    type: 'Bill',
                    amount: anomaly.bill.amount.toNumber(),
                    currency: anomaly.bill.currency,
                    date: anomaly.bill.date
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
