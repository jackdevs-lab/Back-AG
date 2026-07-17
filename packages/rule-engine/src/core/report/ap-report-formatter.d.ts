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
export declare function formatAPReport(params: {
    title: string;
    items: ReportItem[];
    recommendation: string;
    limit?: number;
}): string;
/**
 * Specifically formats duplicate groups for reporting.
 */
export declare function formatDuplicateReport(params: {
    groups: Array<{
        items: any[];
        label: string;
        details: string;
    }>;
    realmId: string;
    baseUrl: string;
    limit?: number;
}): string;
