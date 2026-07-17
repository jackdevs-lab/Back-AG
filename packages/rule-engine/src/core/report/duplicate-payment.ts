import { RuleContext } from '../../types';
import { fetchCustomersByQbIds } from '../shared/data-primitives';
import { formatStandardReport } from '../shared/report-utils';

export async function formatReport(reportData: any, ctx: RuleContext, normErrors: any[]): Promise<string> {
    const customerIds = [...new Set(reportData.findingsForDisplay.map((e: any) => e.metadata?.customerId).filter(Boolean))] as string[];

    let customerMap = new Map<string, string>();
    if (customerIds.length > 0) {
        const customers = await fetchCustomersByQbIds(ctx.repo, { realmId: ctx.realmId, customerQbIds: customerIds as any });
        customerMap = new Map(customers.map((c: any) => [String(c.qbId), String(c.name)]));
    }

    const displayItems = reportData.findingsForDisplay.map((f: any) => ({
        id: f.metadata.clusterIds.join(','),
        label: `${customerMap.get(f.metadata.customerId) || 'Unknown Customer'} - ${f.amount.toFixed(2)}`,
        details: `Found ${f.entities.length} payments on ${f.date.toISOString().split('T')[0]} with the same amount. Affects IDs: ${f.metadata.clusterIds.join(', ')}.`,
        deepLink: f.metadata.clusterIds.map((id: string) => `https://sandbox.qbo.intuit.com/app/recvpayment?realmId=${ctx.realmId}&txnId=${id}`)
    }));

    return formatStandardReport({
        title: 'Potential Duplicate Payments Detected',
        items: displayItems,
        recommendation: 'Recording the same customer payment twice can artificially reduce their AR balance and distort cash flow. Review these sets in QuickBooks. Ensure you only keep the valid payment and properly delete or void the duplicate.',
        summaryData: reportData.findingsSummary,
        metadata: {
            unscannableItems: normErrors
        }
    });
}
