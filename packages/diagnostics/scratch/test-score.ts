import { HealthScoreCalculator } from '../src/health-score';

const mockChecks = [
    { ruleId: 'R1', severity: 'CRITICAL', status: 'PASSED', issueCount: 0 },
    { ruleId: 'R2', severity: 'CRITICAL', status: 'WARNING', issueCount: 5 }, // Should deduct 100% (20 points)
    { ruleId: 'R3', severity: 'HIGH', status: 'WARNING', issueCount: 2 },     // Should deduct 75% (11.25 points)
    { ruleId: 'R4', severity: 'MEDIUM', status: 'WARNING', issueCount: 1 },   // Should deduct 50% (5 points)
    { ruleId: 'R5', severity: 'WARNING', status: 'WARNING', issueCount: 1 },  // Should deduct 25% (1.25 points)
    { ruleId: 'R6', severity: 'INFO', status: 'WARNING', issueCount: 1 },     // Should deduct 10% (0.1 points)
];

console.log('Testing Health Score Calculation...');

const result = HealthScoreCalculator.calculate(mockChecks);

console.log('Breakdown:', JSON.stringify(result, null, 2));

// Manual verification of expected points (New Simplified Model):
// R1: 10 (PASSED)
// R2: 0 (Major Fail)
// R3: 0 (Major Fail)
// R4: 0 (Major Fail)
// R5: 0 (Major Fail - Name not in WARNING_RULES)
// R6: 0 (Major Fail)
// Total Earned: 10
// Total Possible: 60
// Expected Score: (10 / 60) * 100 = 16.66... -> 17

if (result.finalScore === 17) {
    console.log('✅ Calculation logic verified successfully!');
} else {
    console.log(`❌ Calculation mismatch! Expected 47, got ${result.finalScore}`);
}
