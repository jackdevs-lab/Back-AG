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

        resolvedSummary = `Detected ${summaryData.count} findings with a total exposure of ${totalStr}.`;
    }

    const itemList = items.map(item => {
        const linkStr = Array.isArray(item.deepLink)
            ? item.deepLink.map((l, i) => `[Link ${i + 1}](${l})`).join(', ')
            : item.deepLink ? `[View](${item.deepLink})` : item.id;

        return `- **${item.label}** (${linkStr}) — ${item.details}`;
    }).join('\n');
    const trailer = summaryData && summaryData.count > items.length
        ? `\n\n*(Showing top ${items.length} of ${summaryData.count} total findings)*`
        : '';

    const blindSpotsSection = params.blindSpots && params.blindSpots.length > 0
        ? `\n\n### Data Blind Spots\nFound ${params.blindSpots.length} records that could not be fully analyzed due to data integrity issues.`
        : '';

    return [
        `### ${title}`,
        resolvedSummary ? `${resolvedSummary}\n` : '',
        itemList || '_No specific items detected._',
        trailer,
        blindSpotsSection,
        `\n**Recommendation:** ${recommendation}`
    ].filter(Boolean).join('\n');
}

export function getAmountKey(amount: any): string {
    const val = typeof amount?.toNumber === 'function' ? amount.toNumber() : Number(amount || 0);
    return val.toFixed(2);
}
