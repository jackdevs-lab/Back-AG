import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { formatStandardReport } from '../../core/shared/report-utils';

const JE_RATIO_THRESHOLD = 0.20;

export class HighJournalEntryUsageRule implements IRule {
    id: RuleId = 'HIGH_JOURNAL_ENTRY_USAGE' as unknown as RuleId;
    name = 'High Journal Entry Usage';
    severity = 'INFO' as const;
    description = 'Detects over-reliance on manual Journal Entries compared to standard automated workflows.';
    category = 'HYGIENE' as const;
    version = '3.1.0';

    async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const [jeCount, standardCount] = await Promise.all([
            ctx.repo.countTransactionsByType({ realmId: ctx.realmId, type: 'JournalEntry' }),
            ctx.repo.countTransactionsByType({ realmId: ctx.realmId, type: ['Invoice', 'Bill', 'Purchase', 'Payment', 'BillPayment', 'SalesReceipt'] })
        ]);

        if (standardCount === 0) {
            return { status: 'PASSED', message: 'Not enough transaction history to determine usage patterns.', issues: [] };
        }

        const jeRatio = jeCount / standardCount;

        if (jeRatio <= JE_RATIO_THRESHOLD) {
            return {
                status: 'PASSED',
                message: `Journal Entry usage is within acceptable limits (${(jeRatio * 100).toFixed(1)}% of standard transactions).`,
                issues: []
            };
        }

        const report = formatStandardReport({
            title: 'High Journal Entry Usage',
            items: [{
                id: 'je-ratio',
                label: `Journal Entry Ratio: ${(jeRatio * 100).toFixed(1)}%`,
                details: `Found ${jeCount} Journal Entries vs. ${standardCount} standard transactions. The ratio of ${(jeRatio * 100).toFixed(1)}% exceeds the recommended ${(JE_RATIO_THRESHOLD * 100).toFixed(0)}% threshold.`,
                deepLink: `https://sandbox.qbo.intuit.com/app/reportv2?reportName=GeneralLedger&realmId=${ctx.realmId}`
            }],
            recommendation: 'Excessive use of Journal Entries bypasses QuickBooks\' built-in workflows for Accounts Receivable and Payable, making reports unreliable. Replace manual journal entries with proper Invoices, Bills, Payments, and Expenses where possible.'
        });

        return {
            status: 'WARNING',
            message: `High Journal Entry usage: ${(jeRatio * 100).toFixed(1)}% of standard transactions.`,
            issues: [{
                ruleId: this.id, ruleName: this.name, severity: this.severity,
                message: report, entities: []
            }]
        };
    }
}
