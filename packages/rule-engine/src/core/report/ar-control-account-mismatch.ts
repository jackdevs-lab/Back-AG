import { formatStandardReport, ReportItem } from '../shared/report-utils';

export function formatReport(reportData: any, unscannable: any[] = []): string {
    const items: ReportItem[] = reportData.findingsForDisplay.map((f: any) => ({
        id: f.id,
        label: f.label,
        details: `Direct Journal Entry to Accounts Receivable missing customer entity. Line Amount: $${Number(f.amount).toFixed(2)}`
    }));

    if (unscannable && unscannable.length > 0) {
        items.push({
            id: 'DATA_INTEGRITY',
            label: 'Unscannable Records',
            details: `Failed to safely parse ${unscannable.length} transaction(s) during execution.`
        });
    }

    return formatStandardReport({
        title: 'AR Control Account Mismatch',
        items: items,
        recommendation: 'Verify your AR Aging Summary against your Balance Sheet. Ensure no Journal Entries are posted to the Accounts Receivable account without an assigned customer name.',
        summaryData: reportData.findingsSummary
    });
}
