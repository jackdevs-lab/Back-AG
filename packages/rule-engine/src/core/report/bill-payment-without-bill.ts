import { formatStandardReport, formatCurrency } from '../shared/report-utils';

export function formatReport(
    realmId: string,
    reportData: any,
    unscannable: any[] = []
): string {
    const blindSpotsSection = unscannable.length > 0
        ? `\n\n### Data Blind Spots\nFound ${unscannable.length} records that could not be fully analyzed due to data integrity issues: ${unscannable.map(u => u.qbId).join(', ')}.`
        : '';

    const report = formatStandardReport({
        title: 'Bill Payment Without Bill',
        summaryData: reportData.findingsSummary,
        items: reportData.findingsForDisplay.map((f: any) => ({
            id: f.metadata?.qbId || f.id,
            label: `${f.vendorName} - ${formatCurrency(f.amount, f.currency)}`,
            details: `Payment dated ${new Date(f.date).toISOString().split('T')[0]} is not linked to any bill. Fingerprint: ${f.metadata?.fingerprint?.substring(0, 8) || 'N/A'}`,
            deepLink: `https://sandbox.qbo.intuit.com/app/billpayment?realmId=${realmId}&txnId=${f.metadata?.qbId || f.id}`
        })),
        recommendation: 'Every bill payment should be applied to a bill to ensure AP Aging accuracy. Unapplied payments may cause duplicate liability recognition or cash misstatement.'
    });

    return report + blindSpotsSection;
}
