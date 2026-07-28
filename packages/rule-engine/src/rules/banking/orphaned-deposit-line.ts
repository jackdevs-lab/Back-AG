import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch, fetchTransactionsByQbIds } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal, safeDate } from '../../core/shared/base-schemas';

const LinkedTxnSchema = z.object({
    TxnId: z.string().optional(),
    TxnType: z.string().optional()
}).passthrough();

const DepositLineSchema = z.object({
    Amount: safeDecimal.optional(),
    LinkedTxn: z.array(LinkedTxnSchema).optional()
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

export class OrphanedDepositLineRule implements IRule {
    id: RuleId = 'ORPHANED_DEPOSIT_LINE' as unknown as RuleId;
    name = 'Orphaned Deposit Line';
    severity = 'HIGH' as const;
    description = 'Detects deposit lines that reference source transactions (Payments/Receipts) which no longer exist.';
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
            .withDetection(async (norm: NormalizedBatch) => {
                // Collect all linked transaction IDs across all deposits in this batch
                const linkedTxnIds = new Set<string>();
                for (const d of norm.normalized) {
                    const raw: any = d.qboData;
                    for (const line of (raw.Line || [])) {
                        for (const lt of (line.LinkedTxn || [])) {
                            if (lt.TxnId) linkedTxnIds.add(lt.TxnId);
                        }
                    }
                }

                // Check which referenced transactions actually exist
                const existingTxns = linkedTxnIds.size > 0
                    ? await fetchTransactionsByQbIds(ctx.repo, {
                        realmId: ctx.realmId,
                        qbIds: Array.from(linkedTxnIds) as any
                    })
                    : [];
                const existingIds = new Set(existingTxns.map((t: any) => t.qbId));

                const findings = norm.normalized.filter((d) => {
                    const raw: any = d.qboData;
                    return (raw.Line || []).some((line: any) =>
                        (line.LinkedTxn || []).some((lt: any) =>
                            lt.TxnId && !existingIds.has(lt.TxnId)
                        )
                    );
                });
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((d) => {
                    const raw: any = d.qboData;
                    const amount = raw.TotalAmt || 0;
                    const date = raw.TxnDate || d.date;
                    return {
                        id: d.qbId,
                        fingerprint: generateFingerprint([d.qbId]),
                        impactScore: 80,
                        amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: { qbId: d.qbId },
                        entities: [{ id: d.qbId, type: 'Deposit', amount, date: new Date(date) }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.qbId,
                    label: `Deposit ${f.metadata.qbId} — $${f.amount.toFixed(2)}`,
                    details: `Deposit on ${f.date.toISOString().split('T')[0]} references one or more source payments that no longer exist.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/deposit?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
                }));
                return formatStandardReport({
                    title: 'Orphaned Deposit Lines',
                    items: displayItems,
                    recommendation: 'These deposits are linked to payments or receipts that have been deleted. This creates dangling references that can corrupt bank reconciliation. Review and correct these deposits manually.',
                    blindSpots: normErrors
                });
            })
            .execute();
    }
}
