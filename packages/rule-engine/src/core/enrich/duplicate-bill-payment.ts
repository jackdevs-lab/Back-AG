import Decimal from 'decimal.js';
import { getScoringConfig, ScoringConfig } from './config/scoring-rules';
import { NormalizedDuplicateBillPayment } from '../normalize/duplicate-bill-payment';
import { generateFingerprint } from '../shared/utils';

export interface EnrichedDuplicateFinding {
    fingerprint: string;
    impactScore: number;
    payments: NormalizedDuplicateBillPayment[];
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

export function enrichDuplicateFindings(
    clusters: { type: string, payments: NormalizedDuplicateBillPayment[] }[],
    snapshotTimestamp: string
): EnrichedDuplicateFinding[] {
    return clusters.map(cluster => {
        const totalAmount = cluster.payments.reduce((sum, p) => sum + p.amount.toNumber(), 0);
        const qbIds = cluster.payments.map(p => p.qbId!).filter(Boolean);
        const fingerprint = generateFingerprint(qbIds);
        const impactScore = calculateImpactScore(totalAmount);

        return {
            fingerprint,
            impactScore,
            payments: cluster.payments,
            entities: cluster.payments.map(p => ({
                id: p.qbId,
                type: 'BillPayment',
                amount: p.amount.toNumber(),
                currency: p.currency,
                date: p.date
            })),
            metadata: {
                impactScore,
                fingerprint,
                snapshotTimestamp,
                duplicateCount: cluster.payments.length
            }
        };
    });
}
