import { formatStandardReport, formatStandardSummary, ReportParams } from '../shared/report-utils';

export function formatSummary(reportData: any, unscannable: any[] = []): string {
    const findingsCount = reportData?.findingsSummary?.count ?? reportData?.findingsForDisplay?.length ?? reportData?.length ?? 0;
    const unscannableCount = unscannable?.length ?? 0;

    return formatStandardSummary({
        action: 'expense recorded instead of bill payment',
        findingsCount,
        unscannableCount,
        recommendation: 'Investigate identified transactions and consider voiding the incorrect expense to create a proper bill payment.'
    });
}

export function formatReport(reportData: any, unscannable: any[] = []): string {
    const summaryData = reportData?.findingsSummary;

    const params: ReportParams = {
        title: 'Expense Recorded Instead of Bill Payment',
        items: reportData?.findingsForDisplay?.map((finding: any) => ({
            id: finding.id,
            label: finding.label || `Finding ${finding.id}`,
            details: `A direct expense was matched to an open bill for vendor ${finding.metadata?.vendorId || 'Unknown'}.`,
            deepLink: finding.deepLink || undefined,
        })) || [],
        recommendation: 'Investigate the identified transactions. Consider voiding the incorrect expense and creating a proper bill payment against the open bill to ensure accurate tracking of vendor balances and financial reporting.',
        summaryData,
    };

    const reportBody = formatStandardReport(params);

    if (unscannable && unscannable.length > 0) {
        const integritySection = `\n\n### Data Integrity Findings\nCould not process ${unscannable.length} records due to data inconsistencies: ${unscannable.map(i => i.qbId || i.id || 'Unknown').join(', ')}.`;
        return reportBody + integritySection;
    }

    return reportBody;
}