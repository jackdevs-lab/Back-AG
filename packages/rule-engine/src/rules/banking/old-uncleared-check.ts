import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal, safeDate } from '../../core/shared/base-schemas';

const CheckRawSchema = z.object({
    TotalAmt: safeDecimal.optional(),
    TxnDate: safeDate.optional(),
    CurrencyRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    VendorRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    // Checks have a ClearDate once reconciled
    ClearDate: z.string().optional()
}).passthrough();

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof CheckRawSchema> })[];
    unscannable: any[]
};

const UNCLEARED_THRESHOLD_DAYS = 180;

export class OldUnclearedCheckRule implements IRule {
    id: RuleId = 'OLD_UNCLEARED_CHECK' as unknown as RuleId;
    name = 'Old Uncleared Check';
    severity = 'WARNING' as const;
    description = 'Detects checks that were issued more than 180 days ago but have not been cleared in reconciliation.';
    category = 'BANK_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<any[], NormalizedBatch, { findings: any[] }, any>(
            ctx, this.id, this.name, this.version
        )
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - 3);
                return transactionGenerator(repo, {
                    realmId,
                    type: 'Check',
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, CheckRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                const thresholdDate = new Date();
                thresholdDate.setDate(thresholdDate.getDate() - UNCLEARED_THRESHOLD_DAYS);

                const findings = norm.normalized.filter((chk) => {
                    const raw: any = chk.qboData;
                    // Cleared checks have a ClearDate set
                    if (raw.ClearDate) return false;
                    const txnDate = raw.TxnDate || chk.date;
                    if (!txnDate) return false;
                    return new Date(txnDate) < thresholdDate;
                });
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((chk) => {
                    const raw: any = chk.qboData;
                    const amount = raw.TotalAmt || 0;
                    const date = raw.TxnDate || chk.date;
                    const daysOld = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
                    return {
                        id: chk.qbId,
                        fingerprint: generateFingerprint([chk.qbId, amount.toString()]),
                        impactScore: Math.min(100, Math.round(20 + Math.min(80, daysOld / 10))),
                        amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: { qbId: chk.qbId, vendorId: raw.VendorRef?.value, daysOld },
                        entities: [{ id: chk.qbId, type: 'Check', amount, date: new Date(date) }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.qbId,
                    label: `Check ${f.metadata.qbId} � $${f.amount.toFixed(2)} (${f.metadata.daysOld} days old)`,
                    details: `Check issued on ${f.date.toISOString().split('T')[0]} for $${f.amount.toFixed(2)} has not cleared after ${f.metadata.daysOld} days.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/check?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
                }));
                return formatStandardReport({
                    title: 'Old Uncleared Checks',
                    items: displayItems,
                    recommendation: `Checks older than ${UNCLEARED_THRESHOLD_DAYS} days that have not cleared may indicate lost checks, vendor banking issues, or stale payables. Contact the payee or consider voiding and re-issuing the check.`,
                    blindSpots: normErrors
                });
            })
            .execute();
    }
}
