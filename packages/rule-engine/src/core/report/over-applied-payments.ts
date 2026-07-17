import { RuleContext } from '../../types';
import { fetchCustomersByQbIds } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';

export async function formatReport(
    reportData: any,
    ctx: RuleContext,
    normErrors: any[]
): Promise<string> {

    const customerIds = [...new Set(
        reportData.findingsForDisplay
            .map((e: any) => e.metadata?.customerId)
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

        return {
            id: f.metadata.qbId,
            label: `${customerName} - Payment ${f.metadata.qbId}`,
            details: `Payment for $${f.amount.toFixed(2)} has $${f.metadata.totalApplied.toFixed(2)} applied to invoices (Variance: $${f.metadata.variance.toFixed(2)}).`,
            deepLink: `https://sandbox.qbo.intuit.com/app/recvpayment?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
        };
    });

    return formatStandardReport({
        title: 'Over-Applied Customer Payments',
        items: displayItems,
        recommendation: 'A payment should never have more applied to invoices than its total amount. This usually indicates a data corruption issue or manual override error. Review these payments and correct the applied amounts.',
        summaryData: reportData.findingsSummary,
        metadata: {
            unscannableItems: normErrors
        }
    });
}
