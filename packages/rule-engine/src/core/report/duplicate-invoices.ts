import { RuleContext } from '../../types';
import { formatStandardReport } from '../../core/shared/report-utils';
import { fetchCustomersByQbIds } from '../../core/shared/data-primitives';

export async function formatReport(
    reportData: any,
    ctx: RuleContext,
    normErrors: any[]
): Promise<string> {
    const customerIds = [...new Set(
        reportData.findingsForDisplay
            .map((f: any) => f.metadata?.customerId)
            .filter(Boolean)
    )] as string[];

    let customerMap = new Map<string, string>();
    if (customerIds.length > 0) {
        const customers = await fetchCustomersByQbIds(ctx.repo, {
            realmId: ctx.realmId,
            customerQbIds: customerIds as any
        });
        customerMap = new Map(customers.map((c: any) => [String(c.qbId), String(c.name)]));
    }

    const displayItems = reportData.findingsForDisplay.map((f: any) => {
        const customerName = customerMap.get(f.metadata.customerId) || 'Unknown Customer';
        const formattedAmount = f.amount.toFixed(2);
        const isoDate = f.date.toISOString().split('T')[0];
        const clusterIds = f.metadata.clusterIds;

        return {
            id: f.id,
            label: `${customerName} - ${formattedAmount} ${f.currency}`,
            details: `Found ${f.entities.length} invoices on ${isoDate} with the same amount. Affects IDs: ${clusterIds.join(', ')}.`,
            deepLink: clusterIds.map((id: string) => `https://sandbox.qbo.intuit.com/app/invoice?realmId=${ctx.realmId}&txnId=${id}`)
        };
    });

    return formatStandardReport({
        title: 'Potential Duplicate Invoices Detected',
        items: displayItems,
        recommendation: 'Sending duplicate invoices can confuse customers and overstate your revenue. Review these sets in QuickBooks. If one is a replacement, ensure the original was correctly voided or deleted, or use a Credit Memo to offset the error.',
        summaryData: reportData.findingsSummary,
        metadata: {
            unscannableItems: normErrors
        }
    });
}
