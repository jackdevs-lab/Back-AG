// rule.ts
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { generateFingerprint } from '../../core/shared/utils';
import { PaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { formatSummary } from '../../core/report/payment-without-invoice';
import { z } from 'zod';
import { buildQboDeepLink } from '../../core/shared/deeplink';
import { Prisma } from '@qb-health/financial-model';


type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof PaymentRawSchema> })[];
    unscannable: any[];
};

export class PaymentWithoutInvoiceRule implements IRule {
    id: RuleId = 'PAYMENT_WITHOUT_INVOICE' as unknown as RuleId;
    name = 'Payment Without Invoice';
    severity = 'WARNING' as const;
    description = 'Detects customer payments that are not linked to any invoices.';
    category = 'AR_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const realmId = ctx.realmId;
        return new PipelineRunner<
            any[],
            NormalizedBatch,
            { findings: any[] },
            (EnrichedFinding & { fingerprint: string; impactScore: number })[]
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
            .withNormalization((batch: any[]) => {
                return normalizeTransactionBatch(batch, PaymentRawSchema);
            })
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((pay) => {
                    const raw: any = pay.qboData;

                    if (!Array.isArray(raw.Line) || raw.Line.length === 0) return true;

                    const hasLinkedTxn = raw.Line.some((l: any) =>
                        Array.isArray(l.LinkedTxn) && l.LinkedTxn.length > 0
                    );

                    return !hasLinkedTxn;
                });

                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((f: any) => {
                    const raw = f.qboData;
                    const date = raw.TxnDate || f.date;
                    const currency = raw.CurrencyRef?.value || 'USD';

                    // --- CRITICAL FIX: Safely extract and convert amount ---
                    const rawAmount = raw.TotalAmt || 0;
                    const plainExposureAmount = typeof rawAmount?.toNumber === 'function'
                        ? rawAmount.toNumber()
                        : Number(rawAmount || 0);

                    const fingerprint = generateFingerprint([this.id, f.qbId]);
                    const impactScore = Math.min(100, Math.round(30 * Math.min(2, plainExposureAmount / 1000)));

                    return {
                        id: f.qbId,
                        label: `Payment ${f.qbId}`,
                        fingerprint,
                        impactScore,

                        // Satisfies EnrichedFindingSchema (expects Prisma.Decimal)
                        amount: new Prisma.Decimal(plainExposureAmount),
                        currency: currency,
                        date: new Date(date),
                        metadata: {
                            customerId: raw.CustomerRef?.value,
                            qbId: f.qbId,

                            // --- NEW: Add these for database save & API ---
                            exposureAmount: plainExposureAmount,
                            currency: currency
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'Payment',
                            amount: plainExposureAmount, // Use plain number for clean JSON
                            date: new Date(date)
                        }],
                        deepLink: buildQboDeepLink('recvpayment', realmId, f.qbId)
                    } as EnrichedFinding & { fingerprint: string; impactScore: number };
                });
            })
            .withReporting((reportData: any, _ctx: RuleContext, unscannable: any[]) => {
                return formatSummary(reportData, unscannable);
            })
            .execute();
    }
}