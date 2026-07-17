//(production ready)

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { InvoiceRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/duplicate-invoices';
import { z } from 'zod';

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof InvoiceRawSchema> })[];
    unscannable: any[];
};

export class DuplicateInvoicesRule implements IRule {
    id: RuleId = 'DUPLICATE_INVOICE' as unknown as RuleId;
    name = 'Duplicate Customer Invoices';
    severity = 'WARNING' as const;
    description = 'Detects multiple invoices sent to the same customer with identical dates and amounts.';
    category = 'AR_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            any[],
            NormalizedBatch,
            { findings: any[][] },
            EnrichedFinding
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

                for (const inv of norm.normalized) {
                    const raw = inv.qboData;
                    const customerKey = raw.CustomerRef?.value || 'NoCustomer';
                    const dateKey = raw.TxnDate || 'NoDate';
                    const amountKey = raw.TotalAmt ? raw.TotalAmt.toFixed(2) : 'NoAmount';

                    if (amountKey === 'NoAmount' || customerKey === 'NoCustomer') continue;

                    const key = `${customerKey}|${amountKey}|${dateKey}`;

                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(inv);
                }

                const findings = Array.from(groups.values()).filter(g => g.length > 1);
                return { findings };
            })
            .withEnrichment((detected: { findings: any[][] }) => {
                return detected.findings.map((cluster) => {
                    const first = cluster[0];
                    const amount = first.qboData.TotalAmt || 0;

                    const fingerprint = generateFingerprint([this.id, ...cluster.map(c => c.qbId)]);

                    const impactScore = Math.min(100, Math.round(30 * Math.min(2, amount / 1000)));

                    return {
                        id: cluster.map(c => c.qbId).join(','),
                        label: 'Duplicate Invoice Cluster',
                        fingerprint,
                        impactScore,
                        amount,
                        currency: first.qboData.CurrencyRef?.value || 'USD',
                        date: new Date(first.qboData.TxnDate || first.date),
                        metadata: {
                            customerId: first.qboData.CustomerRef?.value,
                            clusterIds: cluster.map(c => c.qbId)
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
                return formatReport(reportData, ctx, normErrors);
            })
            .execute();
    }
}
