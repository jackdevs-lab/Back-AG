import Decimal from 'decimal.js';
import { getScoringConfig, ScoringConfig } from './config/scoring-rules';
import { NormalizedMultipleBill } from '../normalize/multiple-bills-same-amount';
import { generateFingerprint } from '../shared/utils';

export interface EnrichedClusterFinding {
    fingerprint: string;
    impactScore: number;
    bills: NormalizedMultipleBill[];
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

export function enrichClusterFindings(
    clusters: NormalizedMultipleBill[][],
    snapshotTimestamp: string
): EnrichedClusterFinding[] {
    return clusters.map(cluster => {
        const totalAmount = cluster.reduce((sum, b) => sum + b.amount.toNumber(), 0);
        const qbIds = cluster.map(b => b.qbId!).filter(Boolean);
        const fingerprint = generateFingerprint(qbIds);
        const impactScore = calculateImpactScore(totalAmount);

        return {
            fingerprint,
            impactScore,
            bills: cluster,
            entities: cluster.map(b => ({
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
                clusterSize: cluster.length
            }
        };
    });
}
