// rule.ts
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { PaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatSummary } from '../../core/report/duplicate-payment';
import { buildQboDeepLink } from '../../core/shared/deeplink';
import { Prisma } from '@qb-health/financial-model';


type NormalizedBatch = {
    normalized: (any & { qboData: import('zod').infer<typeof PaymentRawSchema> })[];
    unscannable: any[];
};

export class DuplicatePaymentRule implements IRule {
    id: RuleId = 'DUPLICATE_PAYMENT' as unknown as RuleId;
    name = 'Duplicate Customer Payments';
    severity = 'WARNING' as const;
    description = 'Detects multiple customer payments with identical dates, amounts, payment methods, and currencies, which may indicate double-recording.';
    category = 'AR_ERRORS' as const;
    version = '3.1.2';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const realmId = ctx.realmId;
        return new PipelineRunner<
            any[],
            NormalizedBatch,
            { findings: any[][] },
            EnrichedFinding[]
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
                const groups = new Map<string, any[]>();

                for (const pay of norm.normalized) {
                    const raw: any = pay.qboData;

                    const customerKey = raw.CustomerRef?.value || 'NoCustomer';
                    const rawDate = raw.TxnDate || 'NoDate';
                    const dateKey = rawDate !== 'NoDate' ? rawDate.split('T')[0] : 'NoDate';
                    const amountKey = raw.TotalAmt ? raw.TotalAmt.toFixed(2) : 'NoAmount';
                    const paymentMethodKey = raw.PaymentMethodRef?.value || 'NoMethod';

                    const currencyKey = raw.CurrencyRef?.value || 'NoCurrency';

                    if (amountKey === 'NoAmount' || customerKey === 'NoCustomer') continue;

                    const key = `${customerKey}|${amountKey}|${dateKey}|${paymentMethodKey}|${currencyKey}`;

                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(pay);
                }

                const findings = Array.from(groups.values()).filter(g => g.length > 1);
                return { findings };
            })
            .withEnrichment((detected: { findings: any[][] }) => {
                return detected.findings.map((cluster) => {
                    const first = cluster[0];
                    const currency = first.qboData.CurrencyRef?.value || 'USD';

                    // --- CRITICAL FIX: Safely extract and convert amount ---
                    const rawAmount = first.qboData.TotalAmt || 0;
                    const plainExposureAmount = typeof rawAmount?.toNumber === 'function'
                        ? rawAmount.toNumber()
                        : Number(rawAmount || 0);

                    const clusterIds = cluster.map((c: any) => c.qbId);
                    const fingerprint = generateFingerprint([this.id, ...clusterIds]);

                    const clusterLinks = cluster.map(
                        (c: any) => buildQboDeepLink('recvpayment', realmId, c.qbId)
                    );

                    return {
                        id: first.qbId,
                        label: `Duplicate Payments of ${plainExposureAmount.toFixed(2)}`,
                        date: new Date(first.qboData.TxnDate || first.date),

                        // Satisfies EnrichedFindingSchema (expects Prisma.Decimal)
                        amount: new Prisma.Decimal(plainExposureAmount),
                        currency: currency,

                        fingerprint: fingerprint,
                        metadata: {
                            customerId: first.qboData.CustomerRef?.value,
                            clusterIds: clusterIds,
                            paymentMethodId: first.qboData.PaymentMethodRef?.value,
                            clusterLinks,

                            // --- NEW: Add these for database save & API ---
                            exposureAmount: plainExposureAmount,
                            currency: currency
                        },
                        entities: cluster.map((c: any) => ({
                            id: c.qbId,
                            type: 'Payment',
                            amount: plainExposureAmount, // Use plain number for clean JSON
                            date: new Date(c.qboData.TxnDate || c.date)
                        })),
                        deepLink: clusterLinks[0]
                    } as EnrichedFinding;
                });
            })
            .withReporting((reportData: any, ctx: RuleContext, unscannable: any[]) => {
                return formatSummary(reportData, unscannable);
            })
            .execute();
    }
}