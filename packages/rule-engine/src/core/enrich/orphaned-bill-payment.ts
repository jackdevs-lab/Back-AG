import Decimal from 'decimal.js';
import { getScoringConfig, ScoringConfig } from './config/scoring-rules';
import { NormalizedOrphanedBillPayment } from '../normalize/orphaned-bill-payment';
import { generateFingerprint } from '../shared/utils';

export interface EnrichedOrphanedFinding {
    qbId: string;
    vendorId: string | null;
    amount: number;
    currency: string;
    date: Date;
    fingerprint: string;
    impactScore: number;
    missingBillIds: string[];
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

export function enrichOrphanedFindings(
    payments: NormalizedOrphanedBillPayment[],
    existingBillIds: Set<string>,
    snapshotTimestamp: string
): EnrichedOrphanedFinding[] {
    return payments.map(payment => {
        const amount = payment.amount.toNumber();
        const fingerprint = generateFingerprint([payment.qbId || 'unknown']);
        const impactScore = calculateImpactScore(amount);
        const missingBillIds = payment.linkedBillIds.filter(id => !existingBillIds.has(id));

        return {
            qbId: payment.qbId || 'unknown',
            vendorId: payment.vendorId,
            amount,
            currency: payment.currency,
            date: payment.date,
            fingerprint,
            impactScore,
            missingBillIds,
            entities: [{
                id: payment.qbId,
                type: 'BillPayment',
                amount,
                currency: payment.currency,
                date: payment.date
            }],
            metadata: {
                impactScore,
                fingerprint,
                snapshotTimestamp,
                missingBillIds
            }
        };
    });
}
