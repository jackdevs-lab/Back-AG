import { formatStandardReport, ReportItem, formatCurrency } from '../shared/report-utils';

export function formatReport(
    realmId: string,
    aggregatedData: any,
    unscannable: any[] = []
): string {
    const items: ReportItem[] = aggregatedData.findingsForDisplay.map((c: any) => ({
        id: c.id,
        label: c.label,
        details: `Unapplied balance: ${formatCurrency(c.amount, c.currency)} — Dated ${new Date(c.date).toISOString().split('T')[0]}`,
        deepLink: `https://sandbox.qbo.intuit.com/app/vendorcredit?realmId=${realmId}&txnId=${c.id}`
    }));

    const integrityItems: ReportItem[] = unscannable.map((u: any) => ({
        id: u.qbId || 'unknown',
        label: `[DATA_INTEGRITY] Vendor Credit ${u.qbId || 'unknown'}`,
        details: `Incomplete Credit Data: This credit was skipped because of data validation errors. Details: ${u.error}`,
        deepLink: `https://sandbox.qbo.intuit.com/app/expenses?realmId=${realmId}`
    }));

    return formatStandardReport({
        title: 'Unapplied Vendor Credits Detected',
        summaryData: aggregatedData.findingsSummary,
        items: [...items, ...integrityItems],
        recommendation: 'Use the "Pay Bills" window in QuickBooks to apply these credits to outstanding bills for the same vendor. This ensures your AP Aging report accurately reflect your true liabilities.'
    });
}
