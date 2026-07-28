import { formatStandardReport } from '../shared/report-utils';
import { EnrichedFinding } from '../shared/base-schemas';

export function formatReport(
    realmId: string,
    findings: EnrichedFinding[],
    integrityFindings: any[] = [],
    reportData?: any
): string {
    const asOfDate = new Date().toISOString().split('T')[0];

    if (findings.length === 0 && integrityFindings.length === 0) {
        return formatStandardReport({
            title: `Future-Dated Bills Detected (As of ${asOfDate})`,
            summary: 'No future-dated bills or data integrity issues detected at this time.',
            items: [],
            recommendation: 'No action required.'
        });
    }

    const successfulItems = [...findings]
        .sort((a, b) => (a.currency !== b.currency ? a.currency.localeCompare(b.currency) : Number(b.amount) - Number(a.amount)))
        .map(f => {
            const amountValue = typeof f.amount?.toNumber === 'function' ? f.amount.toNumber() : Number(f.amount || 0);

            return {
                id: f.id,
                label: f.label || `Bill ${f.id}`,
                details: `Dated ${new Date(f.date).toISOString().split('T')[0]} — Amount: ${new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: f.currency || 'USD'
                }).format(amountValue)}`,
                deepLink: `https://sandbox.qbo.intuit.com/app/bill?realmId=${realmId}&txnId=${f.id}`
            };
        });

    const integrityItems = integrityFindings.map(f => ({
        id: f.qbId || 'unknown',
        label: `[Data Blind Spot] Bill ${f.qbId || 'Unknown'}`,
        details: `Skipped due to missing critical fields: ${f.details?.fieldErrors ? Object.keys(f.details.fieldErrors).join(', ') : 'Critical data missing.'}`,
        deepLink: `https://sandbox.qbo.intuit.com/app/expenses?realmId=${realmId}`
    }));


    return formatStandardReport({
        title: `Future-Dated Bills Detected (As of ${asOfDate})`,
        items: [...successfulItems, ...integrityItems],
        summaryData: reportData?.findingsSummary || reportData,
        recommendation: 'Verify the bill dates in QuickBooks. If they are data entry errors, correct them. If they are intentional prepayments, consider using a Prepaid Expense account instead.'
    });
}
