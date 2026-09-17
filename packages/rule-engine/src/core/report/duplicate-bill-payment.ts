import { formatStandardReport, ReportItem } from '../../core/shared/report-utils';

export function formatReport(realmId: string, reportData: any, unscannable: any[] = []): string {
    const { findingsSummary, findingsForDisplay } = reportData;

    const items: ReportItem[] = findingsForDisplay.map((f: any) => {
        const amountStr = typeof f.amount?.toFixed === 'function'
            ? f.amount.toFixed(2)
            : Number(f.amount).toFixed(2);

        const deepLinks = f.entities.map(
            (entity: any) => `https://sandbox.qbo.intuit.com/app/billpayment?realmId=${realmId}&txnId=${entity.qbId}`
        );

        return {
            id: f.fingerprint,
            label: `${f.label} (${f.currency} ${amountStr})`,
            details: `Potential duplicate of previous payment (ID: ${f.metadata?.duplicateOf}).`,
            deepLink: deepLinks
        };
    });

    const standardReport = formatStandardReport({
        title: 'Duplicate Bill Payments Analysis',
        summaryData: findingsSummary,
        items: items,
        recommendation: 'Review the identified bill payments to ensure they are not accidental double-payments. Void or delete any confirmed redundant entries to maintain accurate AP balances.'
    });
    const integrityFindingsSection = unscannable.length > 0
        ? `\n\nData Integrity Warnings\nFound ${unscannable.length} records that could not be fully analyzed due to structural data issues. Unscannable IDs: ${unscannable.map(u => u.qbId).join(', ')}.`
        : '';

    return standardReport + integrityFindingsSection;
}

export function formatSummary(reportData: any, unscannable: any[] = []): string {
    const count = reportData?.findingsForDisplay?.length || 0;
    const unscannableCount = unscannable.length;
    const action = 'duplicate bill payments';
    const recommendation = ' Review the identified bill payments to ensure they are not accidental double-payments.';

    let summary = '';
    if (count === 0 && unscannableCount === 0) {
        summary = `No ${action} detected.`;
    } else if (unscannableCount === 0) {
        summary = `Found ${count.toLocaleString()} ${action}.`;
    } else {
        summary = `Found ${count.toLocaleString()} ${action} and ${unscannableCount.toLocaleString()} unscannable records.`;
    }

    return summary + recommendation;
}