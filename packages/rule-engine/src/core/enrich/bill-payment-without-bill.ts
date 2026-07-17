import Decimal from 'decimal.js';
import { getScoringConfig, ScoringConfig } from './config/scoring-rules';
import { NormalizedBillPayment } from '../normalize/bill-payment-without-bill';
import { generateFingerprint } from '../shared/utils';

export interface EnrichedFinding {
    qbId: string;
    vendorId: string | null;
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

export function enrichPaymentFindings(
    payments: NormalizedBillPayment[],
    snapshotTimestamp: string
): EnrichedFinding[] {
    return payments.map(payment => {
        const amount = payment.amount.toNumber();
        const fingerprint = generateFingerprint([payment.qbId || 'unknown']);
        const impactScore = calculateImpactScore(amount);

        return {
            qbId: payment.qbId || 'unknown',
            vendorId: payment.vendorId,
            amount: amount,
            currency: payment.currency,
            date: payment.date,
            fingerprint,
            impactScore,
            entities: [{
                id: payment.qbId,
                type: 'BillPayment',
                amount: amount,
                currency: payment.currency,
                date: payment.date
            }],
            metadata: {
                impactScore,
                fingerprint,
                snapshotTimestamp
            }
        };
    });
}
