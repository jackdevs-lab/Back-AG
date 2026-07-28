import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';

export class DuplicateCustomersRule implements IRule {
    id: RuleId = 'DUPLICATE_CUSTOMER' as unknown as RuleId;
    name = 'Duplicate Customers';
    severity = 'WARNING' as const;
    description = 'Detects potential duplicate customer records by name.';
    category = 'HYGIENE' as const;
    version = '3.1.0';

    async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const customers = await ctx.repo.findCustomers({ realmId: ctx.realmId, active: true });

        const nameGroups = new Map<string, any[]>();
        for (const c of customers) {
            const key = (c.name || '').toLowerCase().trim().replace(/\s+/g, ' ');
            if (!key) continue;
            if (!nameGroups.has(key)) nameGroups.set(key, []);
            nameGroups.get(key)!.push(c);
        }

        const duplicateSets = Array.from(nameGroups.values()).filter(g => g.length > 1);

        if (duplicateSets.length === 0) {
            return { status: 'PASSED', message: 'No duplicate customers detected.', issues: [] };
        }

        const displayItems = duplicateSets.slice(0, 100).map(group => ({
            id: group.map((c: any) => c.qbId).join(','),
            label: `"${group[0].name}" — ${group.length} records`,
            details: `Found ${group.length} customers with the same name. IDs: ${group.map((c: any) => c.qbId).join(', ')}.`,
            deepLink: group.map((c: any) => `https://sandbox.qbo.intuit.com/app/customerdetail?realmId=${ctx.realmId}&nameId=${c.qbId}`)
        }));

        const report = formatStandardReport({
            title: 'Duplicate Customer Records',
            items: displayItems,
            recommendation: 'Duplicate customer records split transaction history, making reporting inaccurate. Merge these records in QuickBooks using the "Merge" feature on the customer detail page.'
        });

        return {
            status: 'WARNING',
            message: `Found ${duplicateSets.length} potential duplicate customer group(s).`,
            issues: [{
                ruleId: this.id, ruleName: this.name, severity: this.severity,
                message: report,
                entities: duplicateSets.flatMap(g => g.map((c: any) => ({ id: c.qbId })))
            }]
        };
    }
}
