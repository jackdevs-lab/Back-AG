import { RuleContext } from '../../types';
import { fetchCustomersByQbIds } from '../../core/shared/data-primitives';
import { formatStandardReport, ReportItem } from '../../core/shared/report-utils';

export async function formatReport(reportData: any, ctx: RuleContext, normErrors: any[]): Promise<string> {
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

    const displayItems: ReportItem[] = reportData.findingsForDisplay.map((f: any) => {
        const customerName = customerMap.get(f.metadata.customerId) || 'Unknown Customer';
        const dateStr = f.date.toISOString().split('T')[0];
        const formattedAmount = typeof f.amount?.toNumber === 'function'
            ? f.amount.toNumber().toFixed(2)
            : Number(f.amount || 0).toFixed(2);

        return {
            id: f.metadata.qbId,
            label: `${customerName} - Payment ${f.metadata.qbId}`,
            details: `Payment for $${formattedAmount} on ${dateStr} is not linked to any invoice.`,
            deepLink: `https://sandbox.qbo.intuit.com/app/recvpayment?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
        };
    });

    return formatStandardReport({
        title: 'Payments Without Invoices',
        items: displayItems,
        recommendation: "Payments that are not linked to an invoice will inflate the customer's credit balance and leave invoices open. Review these payments and apply them to the correct open invoices.",
        summaryData: reportData.findingsSummary,
        metadata: {
            unscannable: normErrors
        }
    });
}
