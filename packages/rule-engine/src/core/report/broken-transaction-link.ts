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