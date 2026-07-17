import { formatStandardReport, PipelineSummary } from '../../core/shared/report-utils';

export function formatReport(
    realmId: string,
    reportData: { findingsSummary: PipelineSummary; findingsForDisplay: any[] },
    unscannable: any[] = []
): string {
    const { findingsSummary, findingsForDisplay } = reportData;

    const blindSpotsSection = unscannable.length > 0
        ? `\n\n### Data Blind Spots\nFound ${unscannable.length} records that could not be fully analyzed due to data integrity issues: ${unscannable.map(u => u.qbId).join(', ')}.`
        : '';

    const report = formatStandardReport({
        title: 'Orphaned Bill Payments Detected',
        summaryData: findingsSummary,
        items: findingsForDisplay.map((f: any) => {
            const missingIdsStr = f.metadata?.missingBillIds?.join(', ') || 'Unknown';
            const fingerprintShort = f.metadata?.fingerprint?.substring(0, 8) || 'N/A';

            return {
                id: f.id,
                label: `${f.label} - ${f.currency} ${Number(f.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                details: `Payment references missing Bill IDs: ${missingIdsStr}. This occurs when a bill is deleted but the payment remains. Fingerprint: ${fingerprintShort}`,
                deepLink: `https://sandbox.qbo.intuit.com/app/billpayment?realmId=${realmId}&txnId=${f.id}`
            };
        }),
        recommendation: 'These payments are linked to non-existent bills. Re-apply these payments to the correct bills or delete them if redundant.',
        metadata: {
            realmId,
            generatedAt: new Date().toISOString()
        }
    });

    return report + blindSpotsSection;
}
