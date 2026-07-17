import { RuleContext } from '../../types';
import { formatStandardReport } from '../../core/shared/report-utils';
import { fetchCustomersByQbIds } from '../shared/data-primitives';

export async function formatReport(reportData: any, ctx: RuleContext, normErrors: any[]): Promise<string> {
    const customerIds = [...new Set(reportData.findingsForDisplay.map((e: any) => e.metadata?.customerId).filter(Boolean))] as string[];

    let customerMap = new Map<string, string>();
    if (customerIds.length > 0) {
        const customers = await fetchCustomersByQbIds(ctx.repo, {
            realmId: ctx.realmId,
            customerQbIds: customerIds as any
        });
        customerMap = new Map(customers.map((c: any) => [String(c.qbId), String(c.name)]));
    }

    const displayItems = reportData.findingsForDisplay.map((f: any) => ({
        id: `${f.metadata.paymentId}-${f.metadata.invoiceId}`,
        label: `${customerMap.get(f.metadata.customerId) || 'Unknown Customer'} - Payment ${f.metadata.paymentId}`,
        details: `Payment of $${f.amount.toFixed(2)} on ${new Date(f.date).toISOString().split('T')[0]} is linked to Invoice ${f.metadata.invoiceId} dated ${new Date(f.metadata.invoiceDate).toISOString().split('T')[0]} (in the future).`,
        deepLink: `https://sandbox.qbo.intuit.com/app/recvpayment?realmId=${ctx.realmId}&txnId=${f.metadata.paymentId}`
    }));

    return formatStandardReport({
        title: 'Payments Dated Before Invoices',
        items: displayItems,
        recommendation: 'A payment cannot logically be received before the invoice it pays is created (unless it is a pre-payment, which should use a different workflow). Ensure your payment and invoice dates are accurate to maintain correct aging reports.',
        summaryData: reportData.findingsSummary,
        metadata: {
            unscannableItems: normErrors
        }
    });
}
