// rule.ts
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { BillPaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatSummary } from '../../core/report/bill-payment-without-bill';
import { z } from 'zod';
import { buildQboDeepLink } from '../../core/shared/deeplink';
import { Prisma } from '@qb-health/financial-model';


type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof BillPaymentRawSchema> })[];
    unscannable: any[]
};

export class BillPaymentWithoutBillRule implements IRule {
    id: RuleId = 'BILL_PAYMENT_WITHOUT_BILL' as unknown as RuleId;
    name = 'Bill Payment Without Bill';
    severity = 'WARNING' as const;
    description = 'Detects bill payments that are not linked to any bills.';
    category = 'AP_ERRORS' as const;
    version = '1.0.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const realmId = ctx.realmId;
        return new PipelineRunner<
            any[],
            NormalizedBatch,
            { findings: any[] },
            EnrichedFinding
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                return transactionGenerator(repo, {
                    realmId,
                    type: 'BillPayment',
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => {
                return normalizeTransactionBatch(batch, BillPaymentRawSchema);
            })
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((item) => {
                    const rawData = item.qboData;

                    if (!rawData || typeof rawData !== 'object' || !Array.isArray(rawData.Line)) {
                        return true;
                    }

                    const hasBillLink = rawData.Line.some((line: any) => {
                        if (!Array.isArray(line.LinkedTxn)) return false;
                        return line.LinkedTxn.some((link: any) =>
                            link?.TxnType?.toLowerCase() === 'bill'
                        );
                    });

                    return !hasBillLink;
                });
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }): EnrichedFinding[] => {
                return detected.findings.map((f: any) => {
                    const currency = f.qboData?.CurrencyRef?.value || 'USD';
                    const fingerprint = generateFingerprint([this.id, f.qbId || 'unknown']);

                    // --- CRITICAL FIX: Safely extract and convert amount ---
                    const rawAmount = f.amount || 0;
                    const plainExposureAmount = typeof rawAmount?.toNumber === 'function'
                        ? rawAmount.toNumber()
                        : Number(rawAmount || 0);

                    const impactScore = Math.min(100, Math.round(20 * Math.min(5, plainExposureAmount / 500)));

                    return {
                        id: f.id || f.qbId,
                        label: `Unlinked Bill Payment ${f.qbId}`,
                        date: f.date,

                        // Satisfies EnrichedFindingSchema (expects Prisma.Decimal)
                        amount: new Prisma.Decimal(plainExposureAmount),
                        currency: currency,

                        fingerprint,
                        impactScore,
                        metadata: {
                            qbId: f.qbId,
                            vendorId: f.vendorId,
                            fingerprint: fingerprint,
                            auditMetadata: {
                                timestamp: new Date().toISOString(),
                                scoreContribution: impactScore
                            },

                            // --- NEW: Add these for database save & API ---
                            exposureAmount: plainExposureAmount,
                            currency: currency
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'BillPayment',
                            amount: plainExposureAmount, // Use plain number for clean JSON
                            currency: currency,
                            date: f.date,
                            currencyConfidence: 1,
                            vendorConfidence: f.vendorId ? 1 : 0,
                            auditMetadata: {
                                scoreContribution: impactScore
                            }
                        }],
                        deepLink: buildQboDeepLink('billpayment', realmId, f.qbId || f.id)
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatSummary(reportData, normErrors);
            })
            .execute();
    }
}