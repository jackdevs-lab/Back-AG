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

const MIN_AMOUNT = 1000; // Only flag amounts >= $1000 to reduce noise

function isRoundNumber(amount: number): boolean {
    if (amount < MIN_AMOUNT) return false;
    // Flag if divisible by 1000 or 500 (e.g. 5000, 10000, 2500)
    return amount % 1000 === 0 || amount % 500 === 0;
}

export class SuspiciousRoundNumberTransactionRule implements IRule {
    id: RuleId = 'SUSPICIOUS_ROUND_NUMBER_TRANSACTION' as unknown as RuleId;
    name = 'Suspicious Round Number Transaction';
    severity = 'WARNING' as const;
    description = 'Detects large transactions with suspiciously round amounts that may indicate estimated or fraudulent entries.';
    category = 'HYGIENE' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<any[], NormalizedBatch, { findings: any[] }, any>(
            ctx, this.id, this.name, this.version
        )
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - 2);
                return transactionGenerator(repo, {
                    realmId,
                    type: ['JournalEntry', 'Bill', 'Invoice', 'Purchase', 'Check'],
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, TxnRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((txn) => {
                    const raw: any = txn.qboData;
                    const amt = raw.TotalAmt;
                    return typeof amt === 'number' && isRoundNumber(amt);
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
                        impactScore: Math.min(100, Math.round(40 * Math.min(2, amount / 10000))),
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
                    details: `${f.metadata.txnType} on ${f.date.toISOString().split('T')[0]} has a suspiciously round amount of $${f.amount.toFixed(2)}.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/reportv2?reportName=GeneralLedger&realmId=${ctx.realmId}`
                }));
                return formatStandardReport({
                    title: 'Suspicious Round-Number Transactions',
                    items: displayItems,
                    recommendation: 'Large transactions with perfectly round amounts can indicate estimated or fabricated entries. Verify each one has a supporting document (receipt, invoice, or contract).',
                    blindSpots: normErrors
                });
            })
            .execute();
    }
}
