import { formatStandardReport, PipelineSummary } from '../../core/shared/report-utils';
import { EnrichedFinding } from '../../core/shared/base-schemas';

export interface ReportAggregatedData {
    findingsForDisplay: EnrichedFinding[];
    findingsSummary: PipelineSummary;
    processedCount: number;
}

export function formatReport(
    realmId: string,
    reportData: ReportAggregatedData,
    unscannable: any[] = []
): string {
    const { findingsForDisplay, findingsSummary } = reportData;

    const blindSpotsSection = unscannable.length > 0
        ? `\n\n### Data Blind Spots\nFound ${unscannable.length} records that could not be fully analyzed due to data integrity issues: ${unscannable.map(u => u.qbId).join(', ')}.`
        : '';

    const report = formatStandardReport({
        title: 'Payment Date Before Bill Date',
        summaryData: findingsSummary,
        items: findingsForDisplay.map((f: any) => {
            const payDate = new Date(f.metadata.paymentDate).toISOString().split('T')[0];
            const billDate = new Date(f.metadata.billDate).toISOString().split('T')[0];
            const fingerprintSegment = f.metadata.fingerprint.substring(0, 8);

            return {
                id: f.id,
                label: f.label,
                details: `Payment (${payDate}) recorded before Bill (${billDate}). Fingerprint: ${fingerprintSegment}`,
                deepLink: [
                    `https://sandbox.qbo.intuit.com/app/billpayment?realmId=${realmId}&txnId=${f.metadata.paymentId}`,
                    `https://sandbox.qbo.intuit.com/app/bill?realmId=${realmId}&txnId=${f.metadata.billId}`
                ]
            };
        }),
        recommendation: 'Ensure your records reflect the correct chronological order. Payments dated before bills can distort AP aging.',
        metadata: {
            realmId,
            generatedAt: new Date().toISOString()
        }
    });

    return report + blindSpotsSection;
}
