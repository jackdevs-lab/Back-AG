import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal, safeDate } from '../../core/shared/base-schemas';

const TxnRawSchema = z.object({
    TotalAmt: safeDecimal.optional(),
    TxnDate: safeDate.optional(),
    CurrencyRef: z.object({ value: z.string().optional() }).passthrough().optional()
}).passthrough();

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof TxnRawSchema> })[];
    unscannable: any[]
};

export class LargeTransactionOutlierRule implements IRule {
    id: RuleId = 'LARGE_TRANSACTION_OUTLIER' as unknown as RuleId;
    name = 'Large Transaction Outlier';
    severity = 'WARNING' as const;
    description = 'Detects transactions that are unusually large compared to historical averages.';
    category = 'HYGIENE' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        // Strategy: compute mean + stddev in-pipeline, flag > mean + 3*stddev
        return new PipelineRunner<any[], NormalizedBatch, { findings: any[] }, any>(
            ctx, this.id, this.name, this.version
        )
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - 2);
                return transactionGenerator(repo, {
                    realmId,
                    type: ['Invoice', 'Bill', 'Purchase', 'Payment', 'Check'],
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, TxnRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                const amounts = norm.normalized
                    .map(t => { const a = (t.qboData as any).TotalAmt; return typeof a === 'number' ? a : 0; })
                    .filter(a => a > 0);

                if (amounts.length < 10) return { findings: [] };

                const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length;
                const variance = amounts.reduce((s, a) => s + Math.pow(a - mean, 2), 0) / amounts.length;
                const stddev = Math.sqrt(variance);
                const threshold = mean + 3 * stddev;

                const findings = norm.normalized.filter(t => {
                    const amt = (t.qboData as any).TotalAmt;
                    return typeof amt === 'number' && amt > threshold;
                });
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((txn) => {
                    const raw: any = txn.qboData;
                    const amount = raw.TotalAmt || 0;
                    const date = raw.TxnDate || txn.date;
                    return {
                        id: txn.qbId,
                        fingerprint: generateFingerprint([txn.qbId, amount.toString()]),
                        impactScore: Math.min(100, Math.round(50 * Math.min(2, amount / 50000))),
                        amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: { qbId: txn.qbId, txnType: txn.type },
                        entities: [{ id: txn.qbId, type: txn.type, amount, date: new Date(date) }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.qbId,
                    label: `${f.metadata.txnType} ${f.metadata.qbId} � $${f.amount.toFixed(2)}`,
                    details: `This ${f.metadata.txnType} on ${f.date.toISOString().split('T')[0]} is unusually large compared to historical averages.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/reportv2?reportName=GeneralLedger&realmId=${ctx.realmId}`
                }));
                return formatStandardReport({
                    title: 'Large Transaction Outliers',
                    items: displayItems,
                    recommendation: 'These transactions are statistical outliers (3+ standard deviations from the mean). Review each one to confirm it is legitimate and correctly recorded.',
                    blindSpots: normErrors
                });
            })
            .execute();
    }
}
