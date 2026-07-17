//(production ready code)

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { CreditMemoRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/unapplied-credit-memos';

type NormalizedBatch = {
    normalized: (any & { qboData: any })[];
    unscannable: any[];
};

export class UnappliedCreditMemosRule implements IRule {
    id: RuleId = 'UNAPPLIED_CREDIT_MEMO' as unknown as RuleId;
    name = 'Unapplied Customer Credit Memos';
    severity = 'WARNING' as const;
    description = 'Detects customer credit memos that have a remaining balance and haven\'t been fully applied to invoices.';
    category = 'AR_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            any[],
            NormalizedBatch,
            { findings: any[] },
            EnrichedFinding
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setDate(lookbackDate.getDate() - 730);

                return transactionGenerator(repo, {
                    realmId,
                    type: 'CreditMemo',
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => {
                return normalizeTransactionBatch(batch, CreditMemoRawSchema);
            })
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((memo) => {
                    const raw = memo.qboData;
                    if (!raw.Balance) return false;
                    return raw.Balance > 0;
                });

                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((f) => {
                    const raw = f.qboData;
                    const balance = raw.Balance || 0;
                    const amount = raw.TotalAmt || 0;
                    const date = raw.TxnDate || f.date;

                    const fingerprint = generateFingerprint([this.id, f.qbId]);
                    const impactScore = Math.min(100, Math.round(30 * Math.min(2, balance / 1000)));

                    return {
                        id: f.qbId,
                        label: `Credit Memo ${f.qbId}`,
                        date: new Date(date),
                        amount: balance,
                        currency: raw.CurrencyRef?.value || 'USD',
                        fingerprint,
                        impactScore,
                        metadata: {
                            customerId: raw.CustomerRef?.value,
                            qbId: f.qbId,
                            unappliedAmount: balance,
                            originalAmount: amount
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'CreditMemo',
                            amount,
                            unappliedAmount: balance,
                            date: new Date(date)
                        }]
                    } as unknown as EnrichedFinding & { fingerprint: string; impactScore: number };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatReport(reportData, ctx, normErrors);
            })
            .execute();
    }
}
