import { formatStandardReport, formatCurrency } from '../../core/shared/report-utils';
import { RuleContext } from '../../types';

export function formatReport(
    aggregatedData: any,
    ctx: RuleContext,
    unscannable: any[] = []
): string {
    const { findingsSummary, findingsForDisplay } = aggregatedData;

    const blindSpotsSection = unscannable.length > 0
        ? `\n\n### Data Blind Spots\nFound ${unscannable.length} records that could not be fully analyzed due to data integrity issues: ${unscannable.map(u => u.qbId).join(', ')}.`
        : '';

    const report = formatStandardReport({
        title: '[REPORT_TITLE]',
        summaryData: findingsSummary,
        items: findingsForDisplay.map((f: any) => {
            const items = f.metadata?.items || [];
            const sortedIds = items.map((i: any) => i.qbId).sort();
            const dates = items.map((i: any) => new Date(i.date).toISOString().split('T')[0]).sort().join(', ');

            const singleAmount = formatCurrency(f.metadata?.singleAmount, f.currency);

            return {
                id: sortedIds.join(','),
                label: `${f.metadata?.vendorName} - ${singleAmount} (x${items.length})`,
                details: `${items.length} bills with identical amounts within window. Dates: ${dates}. Fingerprint: ${f.metadata?.fingerprint?.substring(0, 8)}`,
                deepLink: items.map((i: any) => `https://sandbox.qbo.intuit.com/app/bill?realmId=${ctx.realmId}&txnId=${i.qbId}`)
            };
        }),
        recommendation: '[RECOMMENDATION_TEXT]',
        metadata: {
            realmId: ctx.realmId,
            generatedAt: new Date().toISOString()
        }
    });

    return report + blindSpotsSection;
}
