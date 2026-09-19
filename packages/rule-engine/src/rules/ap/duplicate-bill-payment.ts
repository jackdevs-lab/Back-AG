// rule.ts
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { BillPaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatSummary } from '../../core/report/duplicate-bill-payment';

export class DuplicateBillPaymentsRule implements IRule {
    public id: RuleId = 'DUPLICATE_BILL_PAYMENTS' as unknown as RuleId;
    public name = 'Duplicate Bill Payments';
    public version = '1.0.0';
    public severity = 'HIGH' as const;
    public description = 'Detects multiple bill payments from the same vendor with the same reference number and amount.';
    public category = 'AP_ERRORS' as const;

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const realmId = ctx.realmId;
        const seenPayments = new Map<string, any[]>();

        return new PipelineRunner<
            any[],
            { normalized: z.infer<typeof BillPaymentRawSchema>[], unscannable: any[] },
            { findings: any[] },
            EnrichedFinding
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                return transactionGenerator(repo, {
                    realmId,
                    type: 'BillPayment',
                    lookbackDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
                });
            })
            .withNormalization((batch) => {
                return normalizeTransactionBatch(batch, BillPaymentRawSchema);
            })
            .withDetection((norm) => {
                const findings: any[] = [];

                for (const item of norm.normalized) {
                    const refNum = item.qboData.PaymentRefNum;
                    const amount = item.qboData.TotalAmt;

                    if (!refNum || amount === undefined) continue;

                    const key = `${item.vendorId}-${refNum}-${amount}`;

                    if (seenPayments.has(key)) {
                        const cluster = seenPayments.get(key)!;
                        cluster.push(item);

                        findings.push({
                            ...item,
                            duplicateOf: cluster[0].qbId,
                            clusterItems: [...cluster]
                        });
                    } else {
                        seenPayments.set(key, [item]);
                    }
                }
                return { findings };
            })
            .withEnrichment((detections, _ctx, _norm) => {
                return detections.findings.map((f: any) => {
                    const amountDecimal = new Prisma.Decimal(f.qboData.TotalAmt || 0);

                    const finding: EnrichedFinding & { fingerprint: string } = {
                        id: this.id,
                        label: `Duplicate Payment: Ref ${f.qboData.PaymentRefNum}`,
                        date: new Date(f.date),
                        amount: amountDecimal,
                        currency: f.qboData.CurrencyRef?.value || 'USD',
                        metadata: {
                            duplicateOf: f.duplicateOf,
                            vendorId: f.vendorId
                        },
                        entities: f.clusterItems,
                        fingerprint: generateFingerprint([this.id, f.qbId]),
                        deepLink: f.clusterItems.map((entity: any) => `https://sandbox.qbo.intuit.com/app/billpayment?realmId=${realmId}&txnId=${entity.qbId}`).join(', ')
                    };

                    return finding;
                });
            })
            .withReporting(async (reportData, _ctx, unscannable) => {
                return formatSummary(reportData, unscannable);
            })
            .execute();
    }
}