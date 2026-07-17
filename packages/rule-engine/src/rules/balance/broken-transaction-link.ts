
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch, fetchTransactionQbIds } from '../../core/shared/data-primitives';
import {
    BillRawSchema,
    InvoiceRawSchema,
    PaymentRawSchema,
    CreditMemoRawSchema,
    EnrichedFinding
} from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { z } from 'zod';
import { formatReport } from '../../core/report/broken-transaction-link';

const CombinedTxnSchema = z.union([
    BillRawSchema,
    InvoiceRawSchema,
    PaymentRawSchema,
    CreditMemoRawSchema
]);

export class BrokenTransactionLinkRule implements IRule {
    id: RuleId = 'BROKEN_TRANSACTION_LINK' as unknown as RuleId;
    name = 'Linked Transaction Inconsistency';
    description = 'Detects broken internal links between transactions across major categories (Payment, Invoice, Bill, CreditMemo).';
    severity = 'WARNING' as const;
    category = 'BALANCE' as const;
    version = '3.0.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const allIdsRecords = await fetchTransactionQbIds(ctx.repo, {
            realmId: ctx.realmId,
            excludeStatus: ['Voided', 'Deleted']
        });
        const validIds = new Set(allIdsRecords);

        return new PipelineRunner(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                return transactionGenerator(repo, {
                    realmId,
                    type: ['Payment', 'Invoice', 'Bill', 'CreditMemo'],
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => {
                return normalizeTransactionBatch(batch, CombinedTxnSchema);
            })
            .withDetection((norm: any) => {
                const findings: any[] = [];

                for (const item of norm.normalized) {
                    const lines = item.qboData?.Line || [];
                    for (const line of lines) {
                        const linkedTxns = line.LinkedTxn || [];
                        for (const link of linkedTxns) {
                            if (link.TxnId && !validIds.has(link.TxnId)) {
                                findings.push({ source: item, link });
                            }
                        }
                    }
                }

                return { findings };
            })
            .withEnrichment((detections: any): EnrichedFinding[] => {
                return detections.findings.map((f: any) => ({
                    id: f.source.qbId,
                    label: `Broken link to ${f.link.TxnType || 'transaction'} ${f.link.TxnId}`,
                    date: f.source.date,
                    amount: f.source.amount || 0,
                    currency: f.source.qboData?.CurrencyRef?.value || 'USD',
                    fingerprint: generateFingerprint([this.id, f.source.qbId, f.link.TxnId]),
                    metadata: {
                        impactScore: 30,
                        sourceType: f.source.rawData?.TxnType || f.source.type || 'Transaction',
                        targetId: f.link.TxnId,
                        targetType: f.link.TxnType || 'Unknown'
                    },
                    entities: [{ id: f.source.qbId }, { id: f.link.TxnId }]
                }));
            })
            .withReporting((reportData: any, ctx: RuleContext, unscannable: any[]) => {
                return formatReport(ctx.realmId, reportData, unscannable);
            })
            .execute();
    }
}
