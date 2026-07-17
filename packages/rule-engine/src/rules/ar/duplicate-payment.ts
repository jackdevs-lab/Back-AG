//(production ready) 

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { PaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/duplicate-payment';

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
                    const amount = first.qboData.TotalAmt || 0;

                    const clusterIds = cluster.map((c: any) => c.qbId);
                    const fingerprint = generateFingerprint([this.id, ...clusterIds]);

                    return {
                        id: first.qbId,
                        label: `Duplicate Payments of ${amount.toFixed(2)}`,
                        date: new Date(first.qboData.TxnDate || first.date),
                        amount: amount,
                        currency: first.qboData.CurrencyRef?.value || 'USD',
                        fingerprint: fingerprint,
                        metadata: {
                            customerId: first.qboData.CustomerRef?.value,
                            clusterIds: clusterIds,
                            paymentMethodId: first.qboData.PaymentMethodRef?.value,
                            currency: first.qboData.CurrencyRef?.value
                        },
                        entities: cluster.map((c: any) => ({
                            id: c.qbId,
                            type: 'Payment',
                            amount,
                            date: new Date(c.qboData.TxnDate || c.date)
                        }))
                    } as EnrichedFinding;
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatReport(reportData, ctx, normErrors);
            })
            .execute();
    }
}
