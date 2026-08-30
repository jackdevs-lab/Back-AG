import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal, safeDate } from '../../core/shared/base-schemas';

const DepositLineSchema = z.object({
    Amount: safeDecimal.optional(),
    LinkedTxn: z.array(z.object({
        TxnId: z.string().optional(),
        TxnType: z.string().optional()
    }).passthrough()).optional()
}).passthrough();

const DepositRawSchema = z.object({
    TotalAmt: safeDecimal.optional(),
    TxnDate: safeDate.optional(),
    CurrencyRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    Line: z.array(DepositLineSchema).optional()
}).passthrough();

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof DepositRawSchema> })[];
    unscannable: any[]
};

export class DepositSumMismatchRule implements IRule {
    id: RuleId = 'DEPOSIT_SUM_MISMATCH' as unknown as RuleId;
    name = 'Deposit Line Sum Mismatch';
    severity = 'HIGH' as const;
    description = 'Detects deposits where the sum of line amounts does not match the deposit total.';
    category = 'BANK_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<any[], NormalizedBatch, { findings: any[] }, any>(
            ctx, this.id, this.name, this.version
        )
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - 2);
                return transactionGenerator(repo, { realmId, type: 'Deposit', lookbackDate });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, DepositRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((d) => {
                    const raw: any = d.qboData;
                    const total = raw.TotalAmt || 0;
                    const lines: any[] = raw.Line || [];
                    if (lines.length === 0) return false;
                    const lineSum = lines.reduce((s: number, l: any) => s + (l.Amount || 0), 0);
                    // Allow 1 cent tolerance for rounding
                    return Math.abs(total - lineSum) > 0.01;
                });
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((d) => {
                    const raw: any = d.qboData;
                    const total = raw.TotalAmt || 0;
                    const lineSum = (raw.Line || []).reduce((s: number, l: any) => s + (l.Amount || 0), 0);
                    const variance = Math.abs(total - lineSum);
                    const date = raw.TxnDate || d.date;
                    return {
                        id: d.qbId,
                        fingerprint: generateFingerprint([d.qbId]),
                        impactScore: Math.min(100, Math.round(60 * Math.min(2, variance / 100))),
                        amount: total,
                        currency: raw.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: { qbId: d.qbId, total, lineSum, variance },
                        entities: [{ id: d.qbId, type: 'Deposit', amount: total, date: new Date(date) }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.qbId,
                    label: `Deposit ${f.metadata.qbId} � Total: $${f.metadata.total.toFixed(2)}, Lines: $${f.metadata.lineSum.toFixed(2)}`,
                    details: `Deposit total ($${f.metadata.total.toFixed(2)}) does not match sum of lines ($${f.metadata.lineSum.toFixed(2)}). Variance: $${f.metadata.variance.toFixed(2)}.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/deposit?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
                }));
                return formatStandardReport({
                    title: 'Deposit Line Sum Mismatches',
                    items: displayItems,
                    recommendation: 'When a deposit total does not match the sum of its lines, it signals a data integrity problem that can corrupt bank reconciliation. Review and correct these deposits in QuickBooks.',
                    blindSpots: normErrors
                });
            })
            .execute();
    }
}
