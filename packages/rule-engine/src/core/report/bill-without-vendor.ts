import { formatStandardReport, PipelineSummary } from '../shared/report-utils';

export function formatReport(
    realmId: string,
    reportData: { findingsSummary: PipelineSummary, findingsForDisplay: any[] },
    unscannable: any[] = []
): string {
    const { findingsSummary, findingsForDisplay } = reportData;

    const blindSpotsSection = unscannable.length > 0
        ? `\n\n### Data Blind Spots\nFound ${unscannable.length} records that could not be fully analyzed due to data integrity issues: ${unscannable.map(u => u.qbId).join(', ')}.`
        : '';

    const report = formatStandardReport({
        title: 'Bills Missing Vendor Assignment',
        summaryData: findingsSummary,
        items: findingsForDisplay.map((f: any) => ({
            id: f.id,
            label: `${f.label} - ${new Intl.NumberFormat('en-US', { style: 'currency', currency: f.currency }).format(f.amount)}`,
            details: `Bill dated ${f.date.toISOString().split('T')[0]} lacks a vendor assignment. Fingerprint: ${f.fingerprint.substring(0, 8)}`,
            deepLink: `https://sandbox.qbo.intuit.com/app/bill?realmId=${realmId}&txnId=${f.id}`
        })),
        recommendation: 'Every bill must be assigned to a vendor for accurate AP aging and tax reporting. Review high-exposure items immediately to resolve unassigned liabilities.'
    });

    return report + blindSpotsSection;
}
