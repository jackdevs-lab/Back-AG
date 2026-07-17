//(production ready)

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { PaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/undeposited-funds-aging';

export class UndepositedFundsAgingRule implements IRule {
    id: RuleId = 'UNDEPOSITED_FUNDS_AGING' as unknown as RuleId;
    name = 'Undeposited Funds Aging > 30 Days';
    severity = 'WARNING' as const;
    description = 'Detects payments and sales receipts sitting in Undeposited Funds for more than 30 days.';
    category = 'BANK_ERRORS' as const;

    async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const thresholdDate = new Date();
        thresholdDate.setDate(thresholdDate.getDate() - 30);

        const pipeline = new PipelineRunner<
            any,
            ReturnType<typeof normalizeTransactionBatch<typeof PaymentRawSchema>>,
            { findings: any[] },
            EnrichedFinding[]
        >(ctx, this.id, this.name, '1.0.0');

        return pipeline
            .withData(async (repo, realmId) => {
                return transactionGenerator(repo, {
                    realmId,
                    type: ['Payment', 'SalesReceipt'],
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch) => {
                return normalizeTransactionBatch(batch, PaymentRawSchema);
            })
            .withDetection((normalized) => {
                const findings = normalized.normalized.filter((item: any) => {
                    const date = new Date(item.date);
                    if (date >= thresholdDate) return false;

                    const raw = item.qboData as any;

                    const linkedTxns = raw?.LinkedTxn || [];
                    const lineItems = raw?.Line || [];

                    let hasDepositLink = linkedTxns.some((l: any) => l.TxnType === 'Deposit');

                    if (!hasDepositLink) {
                        hasDepositLink = lineItems.some((line: any) =>
                            (line.LinkedTxn || []).some((l: any) => l.TxnType === 'Deposit')
                        );
                    }

                    if (!hasDepositLink) {
                        return (raw?.DepositToAccountRef?.name === 'Undeposited Funds') ||
                            (raw?.ARAccountRef?.name === 'Undeposited Funds');
                    }

                    return false;
                });

                return { findings };
            })
            .withEnrichment((det) => {
                const enriched: EnrichedFinding[] = det.findings.map((f: any) => ({
                    id: f.qbId,
                    label: `${f.type} Record`,
                    date: new Date(f.date),
                    amount: f.amount,
                    currency: f.qboData?.CurrencyRef?.value || 'USD',
                    metadata: {
                        customer: f.qboData?.CustomerRef?.name || 'Unknown'
                    },
                    entities: [
                        { id: f.qbId, type: f.type, amount: f.amount }
                    ],
                    fingerprint: generateFingerprint([this.id, f.qbId])
                }));

                return enriched;
            })
            .withReporting(formatReport)
            .execute();
    }
}
