import { formatStandardReport, PipelineSummary, ReportItem } from '../shared/report-utils';
import { EnrichedFinding } from '../shared/base-schemas';

export function formatReport(
    realmId: string,
    reportData: { findingsSummary: PipelineSummary; findingsForDisplay: EnrichedFinding[] },
    unscannable: any[]
): string {
    const items: ReportItem[] = reportData.findingsForDisplay.map((f) => ({
        id: f.id,
        label: f.label,
        details: `Transaction on ${f.date ? new Date(f.date).toLocaleDateString() : 'N/A'} references an account ID in its ${f.metadata?.detailType || 'details'} which no longer exists in the Chart of Accounts.`,
        deepLink: `https://sandbox.qbo.intuit.com/app/transaction?realmId=${realmId}&txnId=${f.id}`
    }));

    if (unscannable && unscannable.length > 0) {
        items.push({
            id: 'UNSCANNABLE_DATA',
            label: `Data Integrity Warning (${unscannable.length} items unparsed)`,
            details: `Encountered ${unscannable.length} transactions that could not be fully parsed. This could potentially hide additional deleted account references. Ensure your sync is up-to-date.`
        });
    }

    return formatStandardReport({
        title: 'Transactions with Deleted Account References',
        items: items,
        summaryData: reportData.findingsSummary,
        recommendation: 'These errors typically occur if an account was deleted or merged in QuickBooks without re-associating existing transactions. Review the transactions listed above and update them to point to a valid account in your Chart of Accounts to ensure financial report accuracy.'
    });
}
