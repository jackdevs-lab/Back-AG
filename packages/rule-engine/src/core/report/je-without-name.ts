// core/report/je-without-name.ts
import { formatStandardReport } from '../shared/report-utils';

/**
 * Formats the diagnostic report for journal entries missing entity names.
 */
export function formatReport(
    realmId: string,
    findings: { qbId: string; date: Date | null; missingLines: any[] }[]
): string {
    return formatStandardReport({
        title: 'Journal Entries Missing Entity Names',
        items: findings.map(f => ({
            id: f.qbId,
            label: `JE ${f.qbId} - ${f.missingLines.length} line(s) missing name`,
            details: `Journal Entry on ${f.date ? f.date.toLocaleDateString() : 'N/A'} has lines directly coded to accounts without an associated Customer, Vendor, or Employee name.`,
            deepLink: `https://sandbox.qbo.intuit.com/app/journal?realmId=${realmId}&txnId=${f.qbId}`
        })),
        recommendation: 'Good accounting practice requires identifying the source entity for every transaction line, especially for Balance Sheet accounts. Review these entries in QuickBooks and assign the correct name to each line to maintain clear audit trails and accurate sub-ledger reporting.'
    });
}
