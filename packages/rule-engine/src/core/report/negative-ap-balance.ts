import { formatStandardReport, PipelineSummary } from '../../core/shared/report-utils';
import { RuleContext } from '../../types';

export function formatReport(
    reportData: { findingsForDisplay: any[], findingsSummary: PipelineSummary },
    ctx: RuleContext,
    unscannable: any[] = []
): string {
    const { findingsForDisplay, findingsSummary } = reportData;

    const blindSpotsSection = unscannable.length > 0
        ? `\n\n### Data Blind Spots\nFound ${unscannable.length} records that could not be fully analyzed due to data integrity issues: ${unscannable.map(u => u.qbId || 'Unknown').join(', ')}.`
        : '';

    const report = formatStandardReport({
        title: 'Negative Accounts Payable Balance',
        summaryData: findingsSummary,
        items: findingsForDisplay.map((f: any) => ({
            id: f.id,
            label: f.label,
            details: `Vendor has a net negative AP balance. This often indicates overpayment, unapplied credits, or missing bills. Fingerprint: ${f.metadata.fingerprint.substring(0, 8)}`,
            deepLink: `https://sandbox.qbo.intuit.com/app/bill?realmId=${ctx.realmId}&txnId=${f.id}`
        })),
        recommendation: 'Investigate negative balances immediately. Check for duplicate payments or missing invoices. Apply vendor credits where applicable.',
        metadata: {
            realmId: ctx.realmId,
            generatedAt: new Date().toISOString()
        }
    });

    return report + blindSpotsSection;
}
