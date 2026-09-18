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
import { formatSummary } from '../../core/report/broken-transaction-link';

const CombinedTxnSchema = z.union([
    BillRawSchema,
    InvoiceRawSchema,
    PaymentRawSchema,
    CreditMemoRawSchema
]);

// Same map that formatReport uses — kept in sync deliberately so the
// in-app deep link and the PDF report link point to the same place.
const QBO_ROUTE_MAP: Record<string, string> = {
    invoice: 'invoice',
    bill: 'bill',
    payment: 'recvpayment',
    creditmemo: 'creditmemo'
};

export class BrokenTransactionLinkRule implements IRule {
    id: RuleId = 'BROKEN_TRANSACTION_LINK' as unknown as RuleId;
    name = 'Linked Transaction Inconsistency';
    description = 'Detects broken internal links between transactions across major categories (Payment, Invoice, Bill, CreditMemo).';
    severity = 'WARNING' as const;
    category = 'BALANCE' as const;
    version = '3.0.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const realmId = ctx.realmId;   // <-- captured for use inside withEnrichment

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
                return detections.findings.map((f: any) => {
                    const sourceType = f.source.rawData?.TxnType || f.source.type || 'Transaction';
                    const routePath = QBO_ROUTE_MAP[sourceType.toLowerCase()] || sourceType.toLowerCase();
                    const deepLink = sourceType
                        ? `https://sandbox.qbo.intuit.com/app/${routePath}?realmId=${realmId}&txnId=${f.source.qbId}`
                        : undefined;

                    return {
                        id: f.source.qbId,
                        label: `Broken link to ${f.link.TxnType || 'transaction'} ${f.link.TxnId}`,
                        date: f.source.date,
                        amount: f.source.amount || 0,
                        currency: f.source.qboData?.CurrencyRef?.value || 'USD',
                        fingerprint: generateFingerprint([this.id, f.source.qbId, f.link.TxnId]),
                        metadata: {
                            impactScore: 30,
                            sourceType,
                            targetId: f.link.TxnId,
                            targetType: f.link.TxnType || 'Unknown'
                        },
                        entities: [{ id: f.source.qbId }, { id: f.link.TxnId }],
                        deepLink
                    };
                });
            })
            .withReporting((reportData: any, ctx: RuleContext, unscannable: any[]) => {
                return formatSummary(reportData, unscannable);
            })
            .execute();
    }
}