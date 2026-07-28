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
    CurrencyRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    PrivateNote: z.string().optional(),
    Line: z.array(z.object({ Description: z.string().optional() }).passthrough()).optional()
}).passthrough();

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof TxnRawSchema> })[];
    unscannable: any[]
};

export class TransactionWithoutMemoRule implements IRule {
    id: RuleId = 'TRANSACTION_WITHOUT_MEMO' as unknown as RuleId;
    name = 'Transaction Without Memo';
    severity = 'WARNING' as const;
    description = 'Detects transactions that do not have a memo or description.';
    category = 'HYGIENE' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<any[], NormalizedBatch, { findings: any[] }, any>(
            ctx, this.id, this.name, this.version
        )
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - 2);
                return transactionGenerator(repo, { realmId, type: 'JournalEntry', lookbackDate });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, TxnRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((txn) => {
                    const raw: any = txn.qboData;
                    const hasNote = raw.PrivateNote && raw.PrivateNote.trim().length > 0;
                    const hasLineDesc = Array.isArray(raw.Line) && raw.Line.some((l: any) => l.Description?.trim());
                    return !hasNote && !hasLineDesc;
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
                        fingerprint: generateFingerprint([txn.qbId]),
                        impactScore: 20,
                        amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: { qbId: txn.qbId },
                        entities: [{ id: txn.qbId, type: 'JournalEntry', amount, date: new Date(date) }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.qbId,
                    label: `Journal Entry ${f.metadata.qbId} � $${f.amount.toFixed(2)}`,
                    details: `Journal entry on ${f.date.toISOString().split('T')[0]} has no memo or line descriptions.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/journalentry?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
                }));
                return formatStandardReport({
                    title: 'Transactions Without Memos',
                    items: displayItems,
                    recommendation: 'Journal entries without memos are difficult to audit. Add a note explaining the purpose of each journal entry to ensure a clear audit trail.',
                    blindSpots: normErrors
                });
            })
            .execute();
    }
}
