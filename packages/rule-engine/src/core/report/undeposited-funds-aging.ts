import { RuleContext } from '../../types';
import { formatStandardReport, formatStandardSummary, ReportItem, PipelineSummary } from '../shared/report-utils';

export function formatReport(
    reportData: { findingsSummary: PipelineSummary; findingsForDisplay: any[] },
    ctx: RuleContext,
    unscannable: any[]
): string {
    const items: ReportItem[] = reportData.findingsForDisplay.map((f: any) => ({
        id: f.id,
        label: f.label,
        details: `Date: ${f.date.toLocaleDateString()} | Amount: ${f.amount} | Customer: ${f.metadata?.customer || 'Unknown'}`
    }));

    if (unscannable && unscannable.length > 0) {
        items.push({
            id: 'UNSCANNABLE_DATA',
            label: 'Data Integrity Issues',
            details: `Failed to parse ${unscannable.length} record(s) due to schema validation constraints.`
        });
    }

    return formatStandardReport({
        title: 'Undeposited Funds Aging > 30 Days',
        items,
        summaryData: reportData.findingsSummary,
        recommendation: 'Review the listed payments and sales receipts and ensure they are linked to their corresponding bank deposits to properly clear the Undeposited Funds account.'
    });
}

export function formatSummary(
    reportData: { findingsSummary: PipelineSummary; findingsForDisplay: any[] },
    unscannable: any[]
): string {
    return formatStandardSummary({
        action: 'undeposited funds aging',
        findingsCount: reportData.findingsSummary.count,
        unscannableCount: unscannable?.length || 0,
        recommendation: 'Review payments and sales receipts to ensure they are linked to bank deposits to properly clear the Undeposited Funds account.'
    });
}