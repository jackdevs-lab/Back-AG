import { formatStandardReport, ReportParams, ReportItem, formatCurrency, formatStandardSummary } from '../shared/report-utils';

export function formatSummary(reportData: any, unscannable: any[] = []): string {
    return formatStandardSummary({
        action: 'ap control account mismatches',
        findingsCount: reportData?.findingsForDisplay?.length || 0,
        unscannableCount: unscannable?.length || 0,
        recommendation: 'Review AP Aging vs Balance Sheet. Mismatches often mean JEs posted directly to AP without a vendor.'
    });
}

export function formatReport(reportData: any, unscannable: any[] = []): string {
    const items: ReportItem[] = reportData.findingsForDisplay.map((f: any) => {
        return {
            id: f.id,
            label: f.label,
            details: `Manual Journal Entry bypassing AP sub-ledger (Exposure: ${formatCurrency(f.amount)})`
        };
    });

    if (unscannable && unscannable.length > 0) {
        items.push({
            id: 'UNSCANNABLE',
            label: 'Data Integrity Issues',
            details: `${unscannable.length} records could not be scanned due to invalid payload formats.`
        });
    }

    const params: ReportParams = {
        title: 'AP Control Account Mismatch',
        items: items,
        recommendation: 'Review your AP Aging report against the Balance Sheet. This mismatch typically indicates manual Journal Entries were posted directly to the Accounts Payable account without an associated vendor name, bypassing the sub-ledger sync.',
        summaryData: reportData.findingsSummary
    };

    return formatStandardReport(params);
}