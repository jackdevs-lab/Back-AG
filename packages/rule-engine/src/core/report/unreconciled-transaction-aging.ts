import { formatStandardReport, ReportItem, formatCurrency } from '../../core/shared/report-utils';
import { RuleContext } from '../../types';

const AGING_THRESHOLD_DAYS = 60;

const QBO_BANKING_ROUTE_MAP: Record<string, string> = {
    check: 'check',
    deposit: 'deposit',
    transfer: 'transfer',
    journal: 'journal',
    journalentry: 'journal'
};

export function formatReport(reportData: any, ctx: RuleContext, normErrors: any[]): string {
    const isSandbox = ctx.realmId ? ctx.realmId.startsWith('1935') : false;
    const qboBaseUrl = isSandbox
        ? 'https://sandbox.qbo.intuit.com'
        : 'https://app.qbo.intuit.com';

    const displayItems: ReportItem[] = reportData.findingsForDisplay.map((f: any) => {
        let txnType = f.metadata?.txnType || f.type || 'Transaction';

        if (txnType === 'Transaction' && f.rawData) {
            txnType = f.rawData.Type || f.rawData.txnType || f.rawData.TransactionType || 'Transaction';
        }

        const qbId = f.metadata?.qbId || f.id;
        const normalizedType = String(txnType).toLowerCase().replace(/[^a-z]/g, '');
        const routePath = QBO_BANKING_ROUTE_MAP[normalizedType];


        const deepLink = routePath
            ? `${qboBaseUrl}/app/${routePath}?txnId=${qbId}&txnid=${qbId}`
            : `${qboBaseUrl}/app/reconcile`;

        return {
            id: qbId,
            label: `${txnType} ${qbId} — ${formatCurrency(f.amount, f.currency)} (${f.metadata?.daysOld || 0} days)`,
            details: `${txnType} (Evaluated System Type: "${normalizedType}") from ${f.date ? new Date(f.date).toISOString().split('T')[0] : 'Unknown Date'} has not been reconciled.`,
            deepLink
        };
    });

    return formatStandardReport({
        title: 'Aging Unreconciled Transactions',
        items: displayItems,
        summaryData: reportData.findingsSummary,
        recommendation: `Transactions older than ${AGING_THRESHOLD_DAYS} days that have not been reconciled may indicate missing bank statements or data entry errors. Ensure you are logged into the correct QuickBooks company before clicking these deep links.`,
        metadata: {
            unscannableIssues: normErrors.length > 0 ? normErrors : undefined
        }
    });
}