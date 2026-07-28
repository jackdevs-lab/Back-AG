import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { formatStandardReport } from '../../core/shared/report-utils';

export class InactiveCustomerBalanceRule implements IRule {
    id: RuleId = 'INACTIVE_CUSTOMER_BALANCE' as unknown as RuleId;
    name = 'Inactive Customers with Open Balances';
    severity = 'WARNING' as const;
    description = 'Detects customers who are marked as inactive but still have a non-zero balance on the ledger.';
    category = 'HYGIENE' as const;
    version = '3.1.0';

    async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const customers = await ctx.repo.findCustomers({ realmId: ctx.realmId, active: false });

        const withBalance = customers.filter((c: any) => Math.abs(Number(c.balance || 0)) > 0.01);

        if (withBalance.length === 0) {
            return { status: 'PASSED', message: 'No inactive customers have open balances.', issues: [] };
        }

        const displayItems = withBalance.slice(0, 100).map((c: any) => ({
            id: c.qbId,
            label: `${c.name || 'Unknown'} — Balance: $${Math.abs(Number(c.balance)).toFixed(2)}`,
            details: `Customer is marked Inactive but has a balance of $${Number(c.balance).toFixed(2)} on the ledger.`,
            deepLink: `https://sandbox.qbo.intuit.com/app/customerdetail?realmId=${ctx.realmId}&nameId=${c.qbId}`
        }));

        const report = formatStandardReport({
            title: 'Inactive Customers with Open Balances',
            items: displayItems,
            recommendation: 'Inactive customers with open balances indicate unresolved transactions. Either collect the outstanding amount, issue a credit memo to write it off, or reactivate the customer to address the balance before inactivating again.'
        });

        return {
            status: 'WARNING',
            message: `Found ${withBalance.length} inactive customer(s) with an open balance.`,
            issues: [{
                ruleId: this.id, ruleName: this.name, severity: this.severity,
                message: report,
                entities: withBalance.map((c: any) => ({ id: c.qbId, balance: Number(c.balance) }))
            }]
        };
    }
}
