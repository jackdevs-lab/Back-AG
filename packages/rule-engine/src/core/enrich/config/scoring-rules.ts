export interface ScoringConfig {
    amountThresholdStep: number;
    baseScoreMultiplier: number;
    maxSteps: number;
    maxScore: number;
    allowNegativeAmounts: boolean;
}

export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
    amountThresholdStep: 1000,
    baseScoreMultiplier: 25,
    maxSteps: 4,
    maxScore: 100,
    allowNegativeAmounts: false,
};

export function getScoringConfig(): ScoringConfig {
    return DEFAULT_SCORING_CONFIG;
}
