import { formatStandardReport, ReportItem } from '../shared/report-utils';
import { fetchCustomersByQbIds } from '../shared/data-primitives';
import { RuleContext } from '../../types';

export async function formatReport(reportData: any, ctx: RuleContext, normErrors: any[]): Promise<string> {
    const customerIds = [...new Set(reportData.findingsForDisplay.map((f: any) => f.metadata?.customerId).filter(Boolean))] as string[];
    let customerMap = new Map<string, string>();

    if (customerIds.length > 0) {
        const customers = await fetchCustomersByQbIds(ctx.repo, { realmId: ctx.realmId, customerQbIds: customerIds as any });
        customerMap = new Map(customers.map((c: any) => [String(c.qbId), String(c.name)]));
    }

    const displayItems: ReportItem[] = reportData.findingsForDisplay.map((f: any) => ({
        id: f.metadata.qbId,
        label: `${customerMap.get(f.metadata.customerId) || 'Unknown Customer'} — $${f.amount.toFixed(2)}`,
        details: `Payment on ${f.date.toISOString().split('T')[0]} has not been applied to any invoice.`,
        deepLink: `https://sandbox.qbo.intuit.com/app/recvpayment?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
    }));

    return formatStandardReport({
        title: 'Unapplied Customer Payments',
        items: displayItems,
        recommendation: 'Unapplied payments leave invoices appearing open and overstate your customer credits. Apply each payment to the correct outstanding invoice in QuickBooks.',
        summaryData: reportData.findingsSummary,
        metadata: {
            unscannableItems: normErrors
        }
    });
}
