/**
 * ScoreBreakdown Interface
 * Maintained for backward compatibility and strict typing across the monorepo.
 */
export interface ScoreBreakdown {
    score: number;
    finalScore: number; // Legacy alias for Score
    grade: string;
    color: string;
    totalRules: number;
    passedRules: number;
    warningRules: number;
    failedRules: number;
    pointsEarned: number;
    totalPossiblePoints: number;
}

/**
 * HealthScoreCalculator
 * 
 * Refactored scoring logic using a simplified 3-state weighted system:
 * - PASSED: 10/10 points (100%)
 * - WARNING (Minor): 5/10 points (50%)
 * - CRITICAL (Major): 0/10 points (0%)
 */
export class HealthScoreCalculator {
    // Rules categorized as "WARNING" (Minor) which deduct only 5 points if they fail.
    // All other rules are considered "CRITICAL" (Major) and deduct 10 points.
    private static readonly WARNING_RULES = [
        'Unapplied Vendor Credits',
        'Unapplied Customer Credit Memos',
        'Unapplied Customer Payments',
        'Payment Date Before Bill Date',
        'Payment Date Before Invoice',
        'Undeposited Funds Aging > 30 Days',
        'Unreconciled Transaction Aging'
    ];

    /**
     * Calculates the health score based on backend diagnostic checks.
     * 
     * @param checks Array of diagnostic check results
     * @returns Object containing score, grade, color, and breakdown counts
     */
    static calculate(checks: any[] = []): ScoreBreakdown {
        if (!checks || checks.length === 0) {
            return {
                score: 100,
                finalScore: 100,
                grade: 'EXCELLENT',
                color: '#22c55e',
                totalRules: 0,
                passedRules: 0,
                warningRules: 0,
                failedRules: 0,
                pointsEarned: 0,
                totalPossiblePoints: 0
            };
        }

        const totalRules = checks.length;
        const totalPossiblePoints = totalRules * 10;
        let pointsEarned = 0;
        
        let passedRules = 0;
        let warningRules = 0; // Number of failed "Warning" rules
        let failedRules = 0; // Number of failed "Critical" rules

        checks.forEach(check => {
            if (check.status === 'PASSED') {
                pointsEarned += 10;
                passedRules++;
            } else {
                const isWarningRule = this.WARNING_RULES.includes(check.ruleName);
                
                if (isWarningRule) {
                    // WARNING Rule: Deduct 5 points (50% credit)
                    pointsEarned += 5;
                    warningRules++;
                } else {
                    // CRITICAL Rule: Deduct 10 points (0% credit)
                    pointsEarned += 0;
                    failedRules++;
                }
            }
        });

        // Final score: (Points Earned / Total Possible) * 100
        const score = Math.round((pointsEarned / totalPossiblePoints) * 100);
        
        return {
            score,
            finalScore: score, // Map for backward compatibility
            grade: this.getScoreLabel(score),
            color: this.getScoreColor(score),
            totalRules,
            passedRules,
            warningRules,
            failedRules,
            pointsEarned,
            totalPossiblePoints
        };
    }

    /**
     * Maps numerical score to professional grade labels.
     */
    static getScoreLabel(score: number): string {
        if (score >= 90) return 'EXCELLENT';
        if (score >= 75) return 'GOOD';
        if (score >= 50) return 'FAIR';
        if (score >= 25) return 'POOR';
        return 'CRITICAL';
    }

    /**
     * Maps numerical score to specific UI color hex codes.
     */
    static getScoreColor(score: number): string {
        if (score >= 90) return '#22c55e'; // Green
        if (score >= 75) return '#84cc16'; // Lime
        if (score >= 50) return '#eab308'; // Yellow
        if (score >= 25) return '#f97316'; // Orange
        return '#ef4444'; // Red
    }
}