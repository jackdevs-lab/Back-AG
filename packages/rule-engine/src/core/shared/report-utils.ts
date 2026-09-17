export interface ReportItem {
    id: string;
    label: string;
    details: string;
    deepLink?: string | string[];
}

export interface PipelineSummary {
    count: number;
    totalAmounts: Map<string, any>;
    processedCount?: number;
}

export interface ReportParams {
    title: string;
    items: ReportItem[];
    recommendation: string;
    summary?: string;
    summaryData?: PipelineSummary;
    metadata?: any;
    blindSpots?: any[];
}

export function formatCurrency(amount: any, currency: string = 'USD'): string {
    const value = typeof amount?.toNumber === 'function' ? amount.toNumber() : Number(amount || 0);
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: (currency || 'USD').toUpperCase(),
    }).format(value);
}

export function formatStandardReport(params: ReportParams): string {
    const { title, summary, items, recommendation, summaryData } = params;

    let resolvedSummary = summary || '';
    if (summaryData?.totalAmounts instanceof Map && summaryData.count > 0) {
        const totalStr = Array.from<[string, any]>(summaryData.totalAmounts.entries())
            .map(([curr, amt]) => formatCurrency(amt, curr))
            .join(', ');

        resolvedSummary = `Executive Summary: Identified ${summaryData.count} high-priority items representing a cumulative exposure of ${totalStr}.`;
    }

    const formattedItems = items.map((item, idx) => {
        const linkStr = Array.isArray(item.deepLink)
            ? item.deepLink.map((l, i) => `[Source ${i + 1}](${l})`).join(' | ')
            : item.deepLink ? `[Open in QuickBooks](${item.deepLink})` : `Ref: ${item.id}`;

        return `### ${idx + 1}. ${item.label}\n- **Impact Details:** ${item.details}\n- **QuickBooks Reference:** ${linkStr}`;
    }).join('\n\n');

    return [
        `##  Audit Report: ${title}`,
        `> **Status:** Action Required\n> **Date Generated:** ${new Date().toISOString().split('T')[0]}`,
        `\n${resolvedSummary}\n`,
        `---`,
        `### Detailed Findings`,
        formattedItems || '_No anomalies detected in this category._',
        `\n---`,
        `### Recommended Remediation`,
        `> ${recommendation}`
    ].filter(Boolean).join('\n');
}

export function getAmountKey(amount: any): string {
    const val = typeof amount?.toNumber === 'function' ? amount.toNumber() : Number(amount || 0);
    return val.toFixed(2);
}
/**
 * Bounded, one-line summary suitable for `Issue.message`.
 * Never returns more than ~500 bytes regardless of `findingsCount`.
 *
 * Use this instead of formatStandardReport when building the `message`
 * field. Full reports belong in on-demand rendering, not in the DB.
 */
export function formatStandardSummary(input: {
    action: string;             // e.g. "broken transaction links"
    findingsCount: number;
    unscannableCount?: number;
    recommendation?: string;    // optional one-line advice
}): string {
    const { action, findingsCount, unscannableCount = 0, recommendation } = input;

    if (findingsCount === 0 && unscannableCount === 0) {
        return `No ${action} detected.`;
    }

    const parts: string[] = [];
    if (findingsCount > 0) {
        parts.push(`${findingsCount.toLocaleString()} ${action}`);
    }
    if (unscannableCount > 0) {
        parts.push(
            `${unscannableCount.toLocaleString()} unscannable ${unscannableCount === 1 ? 'record' : 'records'}`
        );
    }

    const summary = `Found ${parts.join(' and ')}.`;
    return recommendation ? `${summary} ${recommendation}` : summary;
}