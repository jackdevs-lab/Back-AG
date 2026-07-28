import { formatStandardReport, ReportItem } from '../../core/shared/report-utils';
import { RuleContext } from '../../types';

export function formatReport(reportData: any, ctx: RuleContext, normErrors: any[]): string {
    const displayItems: ReportItem[] = reportData.findingsForDisplay.map((f: any) => ({
        id: f.metadata.qbId || f.id,
        label: `Deposit ${f.metadata.qbId || f.id}`,
        details: `Deposit on ${f.date.toISOString().split('T')[0]} appears to record customer revenue directly without a linked Payment or Sales Receipt.`,
        deepLink: `https://sandbox.qbo.intuit.com/app/deposit?realmId=${ctx.realmId}&txnId=${f.metadata.qbId || f.id}`
    }));

    return formatStandardReport({
        title: 'Incorrectly Recorded Deposits',
        items: displayItems,
        recommendation: 'Customer payments should be recorded via "Receive Payment" or "Sales Receipt" first, then deposited using "Bank Deposit." Bypassing this workflow breaks the link between the payment and the invoice, leaving invoices open.',
        summaryData: reportData.findingsSummary,
        metadata: {
            unscannableItems: normErrors
        }
    });
}
