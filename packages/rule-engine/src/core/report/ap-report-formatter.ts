// core/report/ap-report-formatter.ts
import { Prisma } from '@qb-health/financial-model';

export interface ReportItem {
    id: string;
    label: string;
    details: string;
    deepLink?: string;
}

/**
 * Standard formatter for AP diagnostic findings.
 * Includes truncation logic to keep reports readable and UI-responsive.
 */
export function formatAPReport(params: {
    title: string;
    items: ReportItem[];
    recommendation: string;
    limit?: number;
}): string {
    const { title, items, recommendation, limit = 15 } = params;
    
    const limitedItems = items.slice(0, limit);
    const list = limitedItems.map(item => {
        const link = item.deepLink ? `[${item.id}](${item.deepLink})` : item.id;
        return `- **${item.label}**: ${link} ${item.details}`;
    }).join('\n');
    
    const trailer = items.length > limit 
        ? `\n\n*(Showing first ${limit} of ${items.length} findings)*`
        : '';
        
    return [
        `**${title}**`,
        list,
        trailer,
        `\n**Recommendation:** ${recommendation}`
    ].join('\n');
}

/**
 * Specifically formats duplicate groups for reporting.
 */
export function formatDuplicateReport(params: {
    groups: Array<{
        items: any[];
        label: string;
        details: string;
    }>;
    realmId: string;
    baseUrl: string; // e.g., 'https://sandbox.qbo.intuit.com/app/bill'
    limit?: number;
}): string {
    const { groups, realmId, baseUrl, limit = 10 } = params;
    
    const list = groups.slice(0, limit).map(group => {
        const links = group.items.map(item => 
            `[${item.qbId}](${baseUrl}?realmId=${realmId}&id=${item.qbId})`
        ).join(', ');
        
        return `- **${group.label}**: ${group.details} (Links: ${links})`;
    }).join('\n');
    
    const trailer = groups.length > limit
        ? `\n\n*(Showing first ${limit} of ${groups.length} duplicate groups)*`
        : '';
        
    return [
        `**Detailed Findings:**`,
        list,
        trailer
    ].join('\n');
}
