import { formatStandardReport } from '../../core/shared/report-utils';

const QBO_ROUTE_MAP: Record<string, string> = {
    invoice: 'invoice',
    bill: 'bill',
    payment: 'recvpayment',
    creditmemo: 'creditmemo'
};

export function formatReport(realmId: string, reportData: any, unscannable: any[]): string {
    const items = reportData.findingsForDisplay.map((f: any) => {
        const sType = f.metadata?.sourceType || 'Transaction';
        const tType = f.metadata?.targetType || 'Transaction';
        const tId = f.metadata?.targetId || 'unknown';

        const normalizedType = sType.toLowerCase();
        const routePath = QBO_ROUTE_MAP[normalizedType] || normalizedType;

        return {
            id: f.id,
            label: `${sType} ${f.id} - References missing ${tType} ${tId}`,
            details: `Source transaction on ${f.date ? new Date(f.date).toLocaleDateString() : 'N/A'} references a transaction ID that no longer exists in the local database.`,
            deepLink: `https://sandbox.qbo.intuit.com/app/${routePath}?realmId=${realmId}&txnId=${f.id}`
        };
    });

    if (unscannable && unscannable.length > 0) {
        items.push({
            id: 'UNSCANNABLE_DATA',
            label: 'Data Integrity Issues',
            details: `${unscannable.length} transactions failed schema validation and could not be evaluated.`
        });
    }

    return formatStandardReport({
        title: 'Linked Transaction Inconsistencies Detected',
        items: items,
        summaryData: reportData.findingsSummary,
        recommendation: 'These "ghost" references often occur when a transaction was manually deleted in QuickBooks instead of being un-applied. Review the source transactions and consider un-applying and re-applying the link to clear the inconsistency.'
    });
}
export function formatSummary(reportData: any, unscannable: any[]): string {
    const findingsCount = reportData?.findingsForDisplay?.length ?? 0;
    const unscannableCount = unscannable?.length ?? 0;

    if (findingsCount === 0 && unscannableCount === 0) {
        return 'No linked transaction inconsistencies detected.';
    }

    const parts: string[] = [];
    if (findingsCount > 0) {
        parts.push(`${findingsCount.toLocaleString()} source ${findingsCount === 1 ? 'transaction' : 'transactions'}`);
    }
    if (unscannableCount > 0) {
        parts.push(`${unscannableCount.toLocaleString()} unscannable ${unscannableCount === 1 ? 'record' : 'records'}`);
    }

    return `Found ${parts.join(' and ')} referencing missing transactions in QuickBooks. ` +
        `Review affected records to un-apply and re-apply the links.`;
}