// rule.ts
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { BillPaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatSummary } from '../../core/report/duplicate-bill-payment';
import { buildQboDeepLink } from '../../core/shared/deeplink';


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
                    const currency = f.qboData.CurrencyRef?.value || 'USD';

                    // --- CRITICAL FIX: Safely extract and convert amount ---
                    const rawAmount = f.qboData.TotalAmt || 0;
                    const plainExposureAmount = typeof rawAmount?.toNumber === 'function'
                        ? rawAmount.toNumber()
                        : Number(rawAmount || 0);

                    const amountDecimal = new Prisma.Decimal(plainExposureAmount);
                    const fingerprint = generateFingerprint([this.id, f.qbId]);

                    const finding: EnrichedFinding & { fingerprint: string } = {
                        id: f.qbId, // Fixed: was this.id, which would make all findings have the same ID
                        label: `Duplicate Payment: Ref ${f.qboData.PaymentRefNum}`,
                        date: new Date(f.date),

                        // Satisfies EnrichedFindingSchema (expects Prisma.Decimal)
                        amount: amountDecimal,
                        currency: currency,

                        metadata: {
                            duplicateOf: f.duplicateOf,
                            vendorId: f.vendorId,

                            // --- NEW: Add these for database save & API ---
                            exposureAmount: plainExposureAmount,
                            currency: currency
                        },

                        // Clean up entities to prevent serializing massive raw objects
                        entities: f.clusterItems.map((c: any) => ({
                            id: c.qbId,
                            type: 'BillPayment',
                            amount: plainExposureAmount, // Use plain number for clean JSON
                            date: c.date
                        })),

                        fingerprint: fingerprint,
                        deepLink: f.clusterItems.map((entity: any) =>
                            buildQboDeepLink('billpayment', realmId, entity.qbId)
                        ).join(', ')
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