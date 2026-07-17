import Decimal from 'decimal.js';
import { getScoringConfig, ScoringConfig } from './config/scoring-rules';
import { NormalizedNegativeBalance } from '../normalize/negative-ap-balance';
import { generateFingerprint } from '../shared/utils';

export interface EnrichedBalanceFinding {
    fingerprint: string;
    impactScore: number;
    vendorId: string;
    vendorName: string;
    balance: number;
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

    const absAmount = Math.abs(amount);

    const stepSize = new Decimal(config.amountThresholdStep);
    const multiplier = new Decimal(config.baseScoreMultiplier);
    const absAmountDec = new Decimal(absAmount);

    const steps = absAmountDec.dividedToIntegerBy(stepSize);
    const cappedSteps = steps.minus(config.maxSteps).isPositive()
        ? config.maxSteps
        : steps.toNumber();

    let rawScore = multiplier.times(cappedSteps).toNumber();

    if (rawScore > config.maxScore) {
        rawScore = config.maxScore;
    }

    return Math.round(rawScore);
}

export function enrichBalanceFindings(
    balances: NormalizedNegativeBalance[],
    snapshotTimestamp: string
): EnrichedBalanceFinding[] {
    return balances.map(balance => {
        const amount = balance.balance.toNumber();
        const fingerprint = generateFingerprint([balance.vendorId, 'NEGATIVE_AP']);
        const impactScore = calculateImpactScore(amount);

        return {
            fingerprint,
            impactScore,
            vendorId: balance.vendorId,
            vendorName: balance.vendorName,
            balance: amount,
            entities: [{
                id: balance.vendorId,
                type: 'Vendor',
                balance: amount
            }],
            metadata: {
                impactScore,
                fingerprint,
                snapshotTimestamp
            }
        };
    });
}
