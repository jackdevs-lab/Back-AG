import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { InvoiceRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/overdue-invoice';

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof InvoiceRawSchema> })[];
    unscannable: any[];
};

export class OverdueInvoiceRule implements IRule {
    id: RuleId = 'OVERDUE_INVOICE' as unknown as RuleId;
    name = 'Overdue Customer Invoice';
    severity = 'WARNING' as const;
    description = 'Detects customer invoices that are past their due date and still have a balance.';
    category = 'AR_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            any,
            NormalizedBatch,
            { findings: any[] },
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
                const now = new Date();
                now.setHours(0, 0, 0, 0);

                const findings = norm.normalized.filter((inv) => {
                    const raw = inv.qboData;
                    if (!raw.Balance || raw.Balance <= 0) return false;
                    if (!raw.DueDate) return false;

                    const dueDate = new Date(raw.DueDate);
                    return dueDate < now;
                });

                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((f) => {
                    const raw = f.qboData;
                    const balance = raw.Balance || 0;
                    const amount = raw.TotalAmt || 0;
                    const dueDate = raw.DueDate ? new Date(raw.DueDate) : new Date();

                    const fingerprint = generateFingerprint([this.id, f.qbId]);
                    const impactScore = Math.min(100, Math.round(30 * Math.min(2, balance / 1000)));

                    return {
                        id: f.qbId,
                        label: `Invoice ${f.qbId}`,
                        date: dueDate,
                        amount: balance,
                        currency: raw.CurrencyRef?.value || 'USD',
                        fingerprint,
                        impactScore,
                        metadata: {
                            customerId: raw.CustomerRef?.value,
                            qbId: f.qbId,
                            balance,
                            totalAmount: amount,
                            dueDate
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'Invoice',
                            amount,
                            balance,
                            date: dueDate
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
