import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { formatStandardReport } from '../../core/shared/report-utils';

export class DuplicateVendorsRule implements IRule {
    id: RuleId = 'DUPLICATE_VENDOR' as unknown as RuleId;
    name = 'Duplicate Vendors';
    severity = 'WARNING' as const;
    description = 'Detects potential duplicate vendor records by name.';
    category = 'HYGIENE' as const;
    version = '3.1.0';

    async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const vendors = await ctx.repo.findVendors({ realmId: ctx.realmId, active: true });

        const nameGroups = new Map<string, any[]>();
        for (const v of vendors) {
            const key = (v.name || '').toLowerCase().trim().replace(/\s+/g, ' ');
            if (!key) continue;
            if (!nameGroups.has(key)) nameGroups.set(key, []);
            nameGroups.get(key)!.push(v);
        }

        const duplicateSets = Array.from(nameGroups.values()).filter(g => g.length > 1);

        if (duplicateSets.length === 0) {
            return { status: 'PASSED', message: 'No duplicate vendors detected.', issues: [] };
        }

        const displayItems = duplicateSets.slice(0, 100).map(group => ({
            id: group.map((v: any) => v.qbId).join(','),
            label: `"${group[0].name}" — ${group.length} records`,
            details: `Found ${group.length} vendors with the same name. IDs: ${group.map((v: any) => v.qbId).join(', ')}.`,
            deepLink: group.map((v: any) => `https://sandbox.qbo.intuit.com/app/vendordetail?realmId=${ctx.realmId}&nameId=${v.qbId}`)
        }));

        const report = formatStandardReport({
            title: 'Duplicate Vendor Records',
            items: displayItems,
            recommendation: 'Duplicate vendors can cause bills and payments to be split across records, making vendor spend reporting unreliable and complicating 1099 filing. Merge these records in QuickBooks.'
        });

        return {
            status: 'WARNING',
            message: `Found ${duplicateSets.length} potential duplicate vendor group(s).`,
            issues: [{
                ruleId: this.id, ruleName: this.name, severity: this.severity,
                message: report,
                entities: duplicateSets.flatMap(g => g.map((v: any) => ({ id: v.qbId })))
            }]
        };
    }
}
