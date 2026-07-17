// core/report/bill-findings.ts
import type { BillDateRuleConfig } from '../normalize/bill-date-rule';
import {
    enrichBillWithVendorInfo,
    formatAmount
} from '../enrich/bill-finding';
import { Prisma } from '@qb-health/financial-model';

/**
 * Pure reporting layer - responsible ONLY for human-readable output formatting.
 * Zero business logic, zero DB, zero side effects.
 * Fully reusable across rules that need bill anomaly reports.
 */
export function generateBillFindingsReport(
    bills: any[],
    snapshotDate: string,
    config: BillDateRuleConfig,
    isStale: boolean
): string {
    const LIMIT = 15;

    const list = bills.slice(0, LIMIT).map(b => {
        // We assume the input b is already normalized or has the structure we need
        // Since this is a shared report, we rely on the caller to provide NormalizedBill-like objects
        const { vendorName, currency } = enrichBillWithVendorInfo(b);
        const amountStr = formatAmount(new Prisma.Decimal(b.amount || 0), currency);
        const date = b.date ? new Date(b.date).toLocaleDateString() : 'N/A';

        return `- **Bill ${b.qbId}** (Vendor: ${vendorName}, Date: ${date}, Amount: ${amountStr} ${currency})`;
    }).join('\n');

    const trailer = bills.length > LIMIT
        ? `\n\n*(Showing first ${LIMIT} of ${bills.length} anomalies found)*`
        : '';

    const stalenessMsg = isStale
        ? `\n\n> [!WARNING]\n> Data sync is stale (>24h). Findings may not reflect latest QuickBooks state.`
        : '';

    const recommendation = `\n\n**Recommendation:** Review these bills in QuickBooks. They exceed the allowed ${config.allowedFutureDays}-day window past the snapshot of **${snapshotDate}**. Future-dated bills can distort balance sheets and periodic accruals.`;

    return [
        '**Detailed Findings:**',
        list,
        trailer,
        stalenessMsg,
        recommendation
    ].join('\n');
}
