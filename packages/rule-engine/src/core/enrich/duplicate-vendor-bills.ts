import Decimal from 'decimal.js';
import { getScoringConfig, ScoringConfig } from './config/scoring-rules';
import { NormalizedDuplicateVendorBill } from '../normalize/duplicate-vendor-bills';
import { generateFingerprint } from '../shared/utils';

export interface EnrichedDuplicateFinding {
    fingerprint: string;
    impactScore: number;
    bills: NormalizedDuplicateVendorBill[];
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
    clusters: { type: string, bills: NormalizedDuplicateVendorBill[] }[],
    snapshotTimestamp: string
): EnrichedDuplicateFinding[] {
    return clusters.map(cluster => {
        const totalAmount = cluster.bills.reduce((sum, b) => sum + b.amount.toNumber(), 0);
        const qbIds = cluster.bills.map(b => b.qbId!).filter(Boolean);
        const fingerprint = generateFingerprint(qbIds);
        const impactScore = calculateImpactScore(totalAmount);

        return {
            fingerprint,
            impactScore,
            bills: cluster.bills,
            entities: cluster.bills.map(b => ({
                id: b.qbId,
                type: 'Bill',
                amount: b.amount.toNumber(),
                currency: b.currency,
                date: b.date
            })),
            metadata: {
                impactScore,
                fingerprint,
                snapshotTimestamp,
                duplicateCount: cluster.bills.length
            }
        };
    });
}
