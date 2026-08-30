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

export class InvoiceDateInFutureRule implements IRule {
    id: RuleId = 'INVOICE_DATE_IN_FUTURE' as unknown as RuleId;
    name = 'Invoice Date In Future';
    severity = 'WARNING' as const;
    description = 'Detects invoices with a date in the future, which can misrepresent your current Accounts Receivable.';
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
                const tomorrow = new Date();
                tomorrow.setHours(24, 0, 0, 0); // Reference: Start of tomorrow

                const findings = norm.normalized.filter((inv) => {
                    const raw = inv.qboData;
                    if (!raw.TxnDate) return false;
                    return raw.TxnDate > tomorrow;
                });

                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((f) => {
                    const amount = f.qboData.TotalAmt || 0;
                    const date = f.qboData.TxnDate || f.date;
                    const fingerprint = generateFingerprint([f.qbId, date.toISOString(), amount.toString()]);
                    const impactScore = Math.min(100, Math.round(30 * Math.min(2, amount / 1000)));

                    return {
                        id: f.qbId,
                        fingerprint,
                        impactScore,
                        amount,
                        currency: f.qboData.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: {
                            customerId: f.qboData.CustomerRef?.value,
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
                const customerIds = [...new Set(reportData.findingsForDisplay.map((e: any) => e.metadata?.customerId).filter(Boolean))] as string[];

                let customerMap = new Map<string, string>();
                if (customerIds.length > 0) {
                    const customers = await fetchCustomersByQbIds(ctx.repo, { realmId: ctx.realmId, customerQbIds: customerIds as any[] });
                    customerMap = new Map(customers.map((c: any) => [String(c.qbId), String(c.name)]));
                }

                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.qbId,
                    label: `${customerMap.get(f.metadata.customerId) || 'Unknown Customer'} - Invoice ${f.metadata.qbId}`,
                    details: `Invoice amount is $${f.amount.toFixed(2)} with a future date of ${f.date.toISOString().split('T')[0]}.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/invoice?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
                }));

                const reportString = formatStandardReport({
                    title: 'Future Dated Invoices Detected',
                    items: displayItems,
                    recommendation: 'Invoices with future dates will not show up in current Accounts Receivable reports and might skew your forecasting. Review these invoices and update their dates to the correct posting date.',
                    blindSpots: normErrors
                });

                return reportString;
            })
            .execute();
    }
}
