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
        ? `\n\n### Data Integrity Warnings\nFound ${unscannable.length} records that could not be fully analyzed due to structural data issues. Unscannable IDs: ${unscannable.map(u => u.qbId).join(', ')}.`
        : '';

    return standardReport + integrityFindingsSection;
}
