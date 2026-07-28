import { formatStandardReport, ReportParams } from '../shared/report-utils';

export function formatReport(
    realmId: string,
    reportData: any,
    unscannableItems: any[] = []
): string {
    const findings = reportData.findingsForDisplay || [];

    const reportParams: ReportParams = {
        title: 'Duplicate Vendor Bills Detected',
        items: findings.map((f: any) => {
            const sortedBillIds = f.entities.map((entity: any) => entity.qbId).sort();
            return {
                id: f.id,
                label: `Vendor: ${f.metadata.vendorId} - Amount: ${f.amount} ${f.currency} - Doc: ${f.metadata.docNumber}`,
                details: `${f.entities.length} duplicate bills found with IDs: ${sortedBillIds.join(', ')}`,
                deepLink: f.entities.map((entity: any) =>
                    `https://sandbox.qbo.intuit.com/app/bill?txnId=${entity.qbId}&realmId=${realmId}`
                )
            };
        }),
        recommendation: 'Review these duplicate bills and remove redundant entries to ensure accurate financial reporting.',
        summaryData: reportData.findingsSummary
    };

    const standardReport = formatStandardReport(reportParams);

    let integritySection = '';
    if (unscannableItems.length > 0) {
        const unscannableIds = unscannableItems.map(item => item.qbId).join(', ');
        integritySection = `\n\n### Data Integrity Issues\nFound ${unscannableItems.length} records that could not be processed due to validation errors:\n${unscannableIds}`;
    }

    return standardReport + integritySection;
}
