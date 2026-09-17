import { formatStandardReport, formatStandardSummary } from '../shared/report-utils';

/**
 * Formats the diagnostic report for unbalanced journal entries.
 */
export function formatReport(
    realmId: string,
    findings: { qbId: string; date: Date | null; debitTotal: number; creditTotal: number; variance: number }[]
): string {
    return formatStandardReport({
        title: 'Unbalanced Journal Entries Detected',
        items: findings.map(f => ({
            id: f.qbId,
            label: `JE ${f.qbId} - Variance of $${f.variance.toFixed(2)}`,
            details: `Journal Entry on ${f.date ? f.date.toLocaleDateString() : 'N/A'} has total debits of $${f.debitTotal.toFixed(2)} and total credits of $${f.creditTotal.toFixed(2)}.`,
            deepLink: `https://sandbox.qbo.intuit.com/app/journal?realmId=${realmId}&txnId=${f.qbId}`
        })),
        recommendation: 'Unbalanced journal entries break the fundamental double-entry logic of your books. Review these entries in QuickBooks and ensure that the sum of all debit lines exactly matches the sum of all credit lines.'
    });
}

export function formatSummary(
    reportData: { qbId: string; date: Date | null; debitTotal: number; creditTotal: number; variance: number }[],
    unscannable: any[] = []
): string {
    return formatStandardSummary({
        action: 'unbalanced journal entries',
        findingsCount: reportData.length,
        unscannableCount: unscannable.length,
        recommendation: 'Review entries in QuickBooks and ensure debits exactly match credits.'
    });
}