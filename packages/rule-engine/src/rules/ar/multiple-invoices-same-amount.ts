import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch, fetchCustomersByQbIds } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal, safeDate } from '../../core/shared/base-schemas';

const InvoiceRawSchema = z.object({
    TotalAmt: safeDecimal.optional(),
    TxnDate: safeDate.optional(),
    CustomerRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    CurrencyRef: z.object({ value: z.string().optional() }).passthrough().optional(),
}).passthrough();

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof InvoiceRawSchema> })[];
    unscannable: any[]
};

export class MultipleInvoicesSameAmountRule implements IRule {
    id: RuleId = 'MULTIPLE_INVOICES_SAME_AMOUNT' as unknown as RuleId;
    name = 'Multiple Invoices (Same Amount)';
    severity = 'WARNING' as const;
    description = 'Detects high-frequency invoices for the same customer and amount.';
    category = 'AR_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            any[],
            NormalizedBatch,
            { findings: any[] },
            any
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setDate(lookbackDate.getDate() - 730);
                return transactionGenerator(repo, {
                    realmId,
                    type: 'Invoice',
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => {
                return normalizeTransactionBatch(batch, InvoiceRawSchema);
            })
            .withDetection((norm: NormalizedBatch) => {
                const groups = new Map<string, any[]>();
                const minCount = 3; // Configurable threshold

                for (const inv of norm.normalized) {
                    const raw = inv.qboData;
                    const customerKey = raw.CustomerRef?.value || 'NoCustomer';
                    const amountKey = raw.TotalAmt ? raw.TotalAmt.toFixed(2) : 'NoAmount';

                    if (amountKey === 'NoAmount' || customerKey === 'NoCustomer' || raw.TotalAmt === 0) continue;

                    const key = `${customerKey}|${amountKey}`;

                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(inv);
                }

                const findings = Array.from(groups.values()).filter(g => g.length >= minCount);
                return { findings };
            })
            .withEnrichment((detected: { findings: any[][] }) => {
                return detected.findings.map((cluster) => {
                    const first = cluster[0];
                    const amount = first.qboData.TotalAmt || 0;
                    const fingerprint = generateFingerprint(cluster.map(c => c.qbId));
                    const impactScore = Math.min(100, Math.round(30 * Math.min(2, amount / 1000)));

                    return {
                        id: first.qbId,
                        fingerprint,
                        impactScore,
                        amount,
                        currency: first.qboData.CurrencyRef?.value || 'USD',
                        date: new Date(first.qboData.TxnDate || first.date),
                        metadata: {
                            customerId: first.qboData.CustomerRef?.value,
                            clusterIds: cluster.map(c => c.qbId),
                            count: cluster.length
                        },
                        entities: cluster.map((c: any) => ({
                            id: c.qbId,
                            type: 'Invoice',
                            amount,
                            date: new Date(c.qboData.TxnDate || c.date)
                        }))
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                const customerIds = [...new Set(reportData.findingsForDisplay.map((e: any) => e.metadata?.customerId).filter(Boolean))] as string[];

                let customerMap = new Map<string, string>();
                if (customerIds.length > 0) {
                    const customers = await fetchCustomersByQbIds(ctx.repo, { realmId: ctx.realmId, customerQbIds: customerIds as any[] });
                    customerMap = new Map(customers.map((c: any) => [String(c.qbId), String(c.name)]));
                }

                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.clusterIds.join(','),
                    label: `${customerMap.get(f.metadata.customerId) || 'Unknown Customer'} - $${f.amount.toFixed(2)}`,
                    details: `Found ${f.metadata.count} invoices for the same amount. Consider using a Recurring Invoice template.`,
                    deepLink: f.metadata.clusterIds.map((id: string) => `https://sandbox.qbo.intuit.com/app/invoice?realmId=${ctx.realmId}&txnId=${id}`)
                }));

                const reportString = formatStandardReport({
                    title: 'High Frequency Identical Invoices',
                    items: displayItems,
                    recommendation: 'If you are repeatedly billing the same customer for the same amount, consider setting up a Recurring Invoice template in QuickBooks to save time and reduce errors.',
                    blindSpots: normErrors
                });

                return reportString;
            })
            .execute();
    }
}
