import { RuleContext } from '../../types';
import { fetchCustomersByQbIds } from '../../core/shared/data-primitives';
import { formatStandardReport, ReportItem, PipelineSummary } from '../../core/shared/report-utils';

export async function formatReport(
    reportData: { findingsForDisplay: any[], findingsSummary: PipelineSummary },
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

    const displayItems: ReportItem[] = reportData.findingsForDisplay.map((f: any) => ({
        id: f.metadata.qbId,
        label: `${customerMap.get(f.metadata.customerId) || 'Unknown Customer'} - Invoice ${f.metadata.qbId}`,
        details: `Invoice has an open balance of $${f.metadata.balance.toFixed(2)} and was due on ${f.metadata.dueDate.toISOString().split('T')[0]}.`,
        deepLink: `https://sandbox.qbo.intuit.com/app/invoice?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
    }));

    let recommendationText = 'Overdue invoices tie up your cash flow. Consider sending reminders or statements to these customers to encourage payment.';

    if (normErrors && normErrors.length > 0) {
        recommendationText += `\n\n*Data Integrity Warning: ${normErrors.length} transaction(s) could not be evaluated due to formatting errors or missing required fields.*`;
    }

    return formatStandardReport({
        title: 'Overdue Customer Invoices',
        items: displayItems,
        recommendation: recommendationText,
        summaryData: reportData.findingsSummary,
        metadata: { unscannable: normErrors }
    });
}
