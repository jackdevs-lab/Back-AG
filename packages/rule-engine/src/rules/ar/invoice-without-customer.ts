import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
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

export class InvoiceWithoutCustomerRule implements IRule {
    id: RuleId = 'INVOICE_WITHOUT_CUSTOMER' as unknown as RuleId;
    name = 'Invoice Without Customer';
    severity = 'HIGH' as const;
    description = 'Detects invoices that are not assigned to any customer.';
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
                const findings = norm.normalized.filter((inv) => {
                    const raw = inv.qboData;
                    const customerId = raw.CustomerRef?.value;
                    return !customerId || customerId.trim() === '';
                });

                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((f) => {
                    const amount = f.qboData.TotalAmt || 0;
                    const date = f.qboData.TxnDate || f.date;
                    const fingerprint = generateFingerprint([f.qbId, amount.toString()]);
                    const impactScore = Math.min(100, Math.round(40 * Math.min(2, amount / 1000)));

                    return {
                        id: f.qbId,
                        fingerprint,
                        impactScore,
                        amount,
                        currency: f.qboData.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: {
                            qbId: f.qbId
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'Invoice',
                            amount,
                            date: new Date(date)
                        }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.qbId,
                    label: `Invoice ${f.metadata.qbId}`,
                    details: `Invoice for $${f.amount.toFixed(2)} on ${f.date.toISOString().split('T')[0]} has no customer assigned.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/invoice?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
                }));

                const reportString = formatStandardReport({
                    title: 'Invoices Missing Customer Assignment',
                    items: displayItems,
                    recommendation: 'Invoices without a customer will not appear in Accounts Receivable aging reports and cannot be properly matched with incoming payments. Review these invoices and assign the correct customer.',
                    blindSpots: normErrors
                });

                return reportString;
            })
            .execute();
    }
}
