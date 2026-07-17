//(production ready 5/5/2026)
import { z } from 'zod';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch, fetchTransactionsByQbIds } from '../../core/shared/data-primitives';
import { PaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/payment-date-before-invoice';

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof PaymentRawSchema>, invoiceDates: Map<string, Date> })[];
    unscannable: any[]
};

export class PaymentDateBeforeInvoiceRule implements IRule {
    id: RuleId = 'PAYMENT_DATE_BEFORE_INVOICE' as unknown as RuleId;
    name = 'Payment Date Before Invoice';
    severity = 'WARNING' as const;
    description = 'Detects customer payments that are dated before the invoices they are linked to.';
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
                    type: 'Payment',
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization(async (batch: any[]) => {
                const { normalized, unscannable } = normalizeTransactionBatch(batch, PaymentRawSchema);

                const invoiceIds = new Set<string>();
                for (const pay of normalized) {
                    const raw = pay.qboData as z.infer<typeof PaymentRawSchema>;
                    if (!Array.isArray(raw.Line)) continue;

                    for (const line of raw.Line) {
                        if (!Array.isArray(line.LinkedTxn)) continue;
                        for (const link of line.LinkedTxn) {
                            if (link.TxnType === 'Invoice' && link.TxnId) {
                                invoiceIds.add(link.TxnId);
                            }
                        }
                    }
                }

                const invoiceDates = new Map<string, Date>();
                if (invoiceIds.size > 0) {
                    const invoiceRecords = await fetchTransactionsByQbIds(ctx.repo, {
                        realmId: ctx.realmId,
                        qbIds: Array.from(invoiceIds) as any[],
                        types: ['Invoice']
                    });
                    for (const inv of invoiceRecords) {
                        if (inv.date) invoiceDates.set(inv.qbId, inv.date);
                    }
                }

                const enrichedNormalized = normalized.map(pay => ({
                    ...pay,
                    invoiceDates
                }));

                return { normalized: enrichedNormalized, unscannable };
            })
            .withDetection((norm: NormalizedBatch) => {
                const findings: any[] = [];

                for (const pay of norm.normalized) {
                    const raw = pay.qboData;
                    if (!raw.TxnDate) continue;

                    const payDate = new Date(raw.TxnDate);
                    payDate.setHours(0, 0, 0, 0);

                    if (!Array.isArray(raw.Line)) continue;

                    for (const line of raw.Line) {
                        if (!Array.isArray(line.LinkedTxn)) continue;
                        for (const link of line.LinkedTxn) {
                            if (link.TxnType === 'Invoice' && link.TxnId) {
                                const invDate = pay.invoiceDates.get(link.TxnId);
                                if (!invDate) continue;

                                invDate.setHours(0, 0, 0, 0);

                                if (payDate < invDate) {
                                    findings.push({
                                        payment: pay,
                                        invoiceId: link.TxnId,
                                        invoiceDate: invDate
                                    });
                                }
                            }
                        }
                    }
                }

                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((f) => {
                    const pay = f.payment;
                    const raw = pay.qboData;
                    const amount = raw.TotalAmt || 0;
                    const payDate = raw.TxnDate || pay.date;
                    const invoiceDate = f.invoiceDate;

                    const fingerprint = generateFingerprint([this.id, pay.qbId, f.invoiceId]);
                    const impactScore = Math.min(100, Math.round(30 * Math.min(2, amount / 1000)));

                    return {
                        id: pay.qbId,
                        label: `Payment ${pay.qbId}`,
                        fingerprint,
                        impactScore,
                        amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        date: new Date(payDate),
                        metadata: {
                            customerId: raw.CustomerRef?.value,
                            paymentId: pay.qbId,
                            invoiceId: f.invoiceId,
                            invoiceDate: invoiceDate
                        },
                        entities: [{
                            id: pay.qbId,
                            type: 'Payment',
                            amount,
                            paymentDate: new Date(payDate),
                            invoiceDate: invoiceDate
                        }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatReport(reportData, ctx, normErrors);
            })
            .execute();
    }
}
