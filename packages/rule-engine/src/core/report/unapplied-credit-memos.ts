import { RuleContext } from '../../types';
import { fetchCustomersByQbIds } from '../../core/shared/data-primitives';
import { formatStandardReport, ReportItem } from '../../core/shared/report-utils';

export async function formatReport(
    reportData: any,
    ctx: RuleContext,
    normErrors: any[]
): Promise<string> {

    const customerIds = [...new Set(reportData.findingsForDisplay.map((e: any) => e.metadata?.customerId).filter(Boolean))] as string[];

    let customerMap = new Map<string, string>();
    if (customerIds.length > 0) {
        const customers = await fetchCustomersByQbIds(ctx.repo, {
            realmId: ctx.realmId,
            customerQbIds: customerIds as any
        });
        customerMap = new Map(customers.map((c: any) => [String(c.qbId), String(c.name)]));
    }

    const displayItems: ReportItem[] = reportData.findingsForDisplay.map((f: any) => {
        const customerName = customerMap.get(f.metadata.customerId) || 'Unknown Customer';
        const originalAmt = f.metadata.originalAmount.toFixed(2);
        const unappliedAmt = f.metadata.unappliedAmount.toFixed(2);
        const dateStr = f.date.toISOString().split('T')[0];

        return {
            id: f.metadata.qbId,
            label: `${customerName} - Credit Memo ${f.metadata.qbId}`,
            details: `Credit Memo for $${originalAmt} on ${dateStr} still has $${unappliedAmt} unapplied.`,
            deepLink: `https://sandbox.qbo.intuit.com/app/creditmemo?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
        };
    });

    const errorItems: ReportItem[] = normErrors.map((err: any) => ({
        id: err.qbId || 'UNKNOWN_ID',
        label: `Unscannable Credit Memo (ID: ${err.qbId || 'Unknown'})`,
        details: `Data validation failed: ${err.error}. This transaction could not be analyzed and represents a blind spot.`,
        deepLink: err.qbId ? `https://sandbox.qbo.intuit.com/app/creditmemo?realmId=${ctx.realmId}&txnId=${err.qbId}` : undefined
    }));
    const allReportItems: ReportItem[] = [...displayItems, ...errorItems];

    return formatStandardReport({
        title: 'Unapplied Customer Credit Memos',
        items: allReportItems,
        recommendation: 'Unapplied credit memos falsely inflate your customer\'s available credit and understate your Accounts Receivable. Review these credit memos and apply them to open invoices or issue refunds. Ensure any unscannable items are manually reviewed.',
        summaryData: reportData.findingsSummary,
        metadata: {
            unscannableCount: normErrors.length
        }
    });
}
