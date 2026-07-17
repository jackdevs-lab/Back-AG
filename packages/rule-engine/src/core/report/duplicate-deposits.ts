import { RuleContext } from '../../types';
import { formatStandardReport, PipelineSummary, ReportItem } from '../shared/report-utils';

interface ReportData {
    findingsForDisplay: any[];
    findingsSummary: PipelineSummary;
}

export async function formatReport(
    reportData: ReportData,
    ctx: RuleContext,
    normErrors: any[]
): Promise<string> {

    const displayItems: ReportItem[] = reportData.findingsForDisplay.map((f: any) => ({
        id: f.metadata.clusterIds.join(','),
        label: `Duplicate Group — $${f.amount.toFixed(2)} on ${f.date.toISOString().split('T')[0]}`,
        details: `Found ${f.entities.length} deposits with identical date, amount, and account. IDs: ${f.metadata.clusterIds.join(', ')}.`,
        deepLink: f.metadata.clusterIds.map((id: string) => `https://sandbox.qbo.intuit.com/app/deposit?realmId=${ctx.realmId}&txnId=${id}`)
    }));

    const blindSpotWarning = normErrors && normErrors.length > 0
        ? `\n\n*Note:* ${normErrors.length} deposit(s) could not be scanned due to data integrity issues and were excluded from this analysis.`
        : '';

    return formatStandardReport({
        title: 'Duplicate Bank Deposits',
        items: displayItems,
        summaryData: reportData.findingsSummary,
        recommendation: `These transaction groups share identical markers. This may indicate redundant data entry or an automated bank feed issue. Verify in QuickBooks and delete any true duplicates to avoid overstating assets.${blindSpotWarning}`
    });
}
