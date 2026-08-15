import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch, fetchCustomersByQbIds } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal, safeDate } from '../../core/shared/base-schemas';

const InvoiceLineSchema = z.object({
    DetailType: z.string().optional(),
    Amount: safeDecimal.optional()
}).passthrough();

const InvoiceRawSchema = z.object({
    TotalAmt: safeDecimal.optional(),
    TxnDate: safeDate.optional(),
    CustomerRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    CurrencyRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    Line: z.array(InvoiceLineSchema).optional()
}).passthrough();

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof InvoiceRawSchema> })[];
    unscannable: any[]
};

export class InvoiceLineDirectToAccountRule implements IRule {
    id: RuleId = 'INVOICE_LINE_DIRECT_TO_ACCOUNT' as unknown as RuleId;
    name = 'Invoice Line Direct To Account';
    severity = 'WARNING' as const;
    description = 'Detects invoices with lines coded directly to accounts instead of products/services.';
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
                    if (!Array.isArray(raw.Line)) return false;

                    return raw.Line.some((l: any) =>
                        l.DetailType === 'AccountBasedExpenseLineDetail' ||
                        l.DetailType === 'AccountBasedRevenueLineDetail'
                    );
                });

                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((f) => {
                    const raw = f.qboData;
                    const directLines = (raw.Line || []).filter((l: any) =>
                        l.DetailType === 'AccountBasedExpenseLineDetail' ||
                        l.DetailType === 'AccountBasedRevenueLineDetail'
                    );
                    const directAmount = directLines.reduce((sum: number, l: any) => sum + (l.Amount || 0), 0);

                    const amount = raw.TotalAmt || 0;
                    const date = raw.TxnDate || f.date;
                    const fingerprint = generateFingerprint([f.qbId, directAmount.toString()]);
                    const impactScore = Math.min(100, Math.round(30 * Math.min(2, directAmount / 1000)));

                    return {
                        id: f.qbId,
                        fingerprint,
                        impactScore,
                        amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: {
                            customerId: raw.CustomerRef?.value,
                            qbId: f.qbId,
                            directLineCount: directLines.length
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'Invoice',
                            amount,
                            directAmount,
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
                    details: `Invoice has ${f.metadata.directLineCount} line(s) coded directly to an account instead of an item/product. Total invoice amount is $${f.amount.toFixed(2)}.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/invoice?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
                }));

                const reportString = formatStandardReport({
                    title: 'Invoices Using Direct Account Coding',
                    items: displayItems,
                    recommendation: 'Invoices should typically use Items (Products/Services) rather than coding directly to GL accounts. Using Items ensures your Sales by Product/Service reports are accurate and inventory is tracked properly.',
                    blindSpots: normErrors
                });

                return reportString;
            })
            .execute();
    }
}
