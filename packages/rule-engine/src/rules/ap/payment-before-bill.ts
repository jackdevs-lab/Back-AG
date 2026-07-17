//( production ready)
import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { formatReport } from '../../core/report/payment-before-bill';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { BillRawSchema, BillPaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';

export class PaymentBeforeBillRule implements IRule {
    id: RuleId = 'PAYMENT_BEFORE_BILL' as unknown as RuleId;
    name = 'Payment Date Before Bill Date';
    severity = 'WARNING' as const;
    description = 'Detects bill payments that are dated before the bill they apply to.';
    category = 'AP_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            any[],
            { normalized: any[]; unscannable: any[] },
            { findings: any[] },
            EnrichedFinding
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setDate(lookbackDate.getDate() - 730);

                return transactionGenerator(repo, {
                    realmId,
                    type: ['Bill', 'BillPayment'],
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => {
                const schema = z.union([BillPaymentRawSchema, BillRawSchema]);
                const { normalized, unscannable } = normalizeTransactionBatch(batch, schema);

                return {
                    normalized,
                    unscannable
                };
            })
            .withDetection((norm: { normalized: any[]; unscannable: any[] }) => {
                const billsMap = new Map<string, any>();
                const payments: any[] = [];

                for (const tx of norm.normalized) {
                    if (tx.type === 'Bill' && tx.qbId) {
                        billsMap.set(tx.qbId, tx);
                    } else if (tx.type === 'BillPayment') {
                        payments.push(tx);
                    }
                }

                const findings: any[] = [];

                for (const payment of payments) {
                    const parsedRaw = payment.qboData;
                    const linkedBillIds = new Set<string>();

                    if (parsedRaw?.Line) {
                        const lines = Array.isArray(parsedRaw.Line) ? parsedRaw.Line : [parsedRaw.Line];
                        for (const line of lines) {
                            const links = Array.isArray(line.LinkedTxn) ? line.LinkedTxn : [line.LinkedTxn];
                            for (const link of links) {
                                if (link?.TxnType === 'Bill' && link?.TxnId) {
                                    linkedBillIds.add(String(link.TxnId));
                                }
                            }
                        }
                    }

                    for (const billId of Array.from(linkedBillIds)) {
                        const bill = billsMap.get(billId);
                        if (bill && payment.date.getTime() < bill.date.getTime()) {
                            findings.push({ payment, bill });
                        }
                    }
                }

                return { findings };
            })
            .withEnrichment((det: { findings: any[] }, ctx: RuleContext): EnrichedFinding[] => {
                return det.findings.map((f: any): EnrichedFinding => {
                    const fingerprint = generateFingerprint([this.id, f.payment.qbId, f.bill.qbId]);

                    return {
                        id: `${f.payment.qbId}-${f.bill.qbId}`,
                        label: `Payment precedes Bill (Vendor ID: ${f.payment.vendorId || 'Unknown'})`,
                        date: f.payment.date,
                        amount: f.payment.amount,
                        currency: f.payment.currency || 'USD',
                        metadata: {
                            fingerprint,
                            paymentId: f.payment.qbId,
                            billId: f.bill.qbId,
                            paymentDate: f.payment.date,
                            billDate: f.bill.date,
                            vendorId: f.payment.vendorId
                        },
                        entities: [f.payment, f.bill]
                    };
                });
            })
            .withReporting((aggregatedData: any, ctx: RuleContext, allUnscannable: any[]) => {
                return formatReport(ctx.realmId, aggregatedData, allUnscannable);
            })
            .execute();
    }
}
