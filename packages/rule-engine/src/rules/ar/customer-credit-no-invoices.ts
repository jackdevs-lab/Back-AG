import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { fetchCustomers, fetchTransactions } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal } from '../../core/shared/base-schemas';

const CustomerRawSchema = z.object({
    qbId: z.string(),
    name: z.string().nullable().optional(),
    balance: safeDecimal,
    invoiceCount: z.number().int()
}).passthrough();

export class CustomerCreditNoInvoicesRule implements IRule {
    id: RuleId = 'CUSTOMER_CREDIT_NO_INVOICE' as unknown as RuleId;
    name = 'Customer Credit (No Invoice History)';
    severity = 'WARNING' as const;
    description = 'Detects customers who have a credit balance but have no invoices recorded.';
    category = 'AR_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            any,
            { normalized: any[], unscannable: any[] },
            { findings: any[] },
            any
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                async function* getCustomerStatsGenerator() {
                    const customers = await fetchCustomers(repo, { realmId, active: true });

                    const invoices = await fetchTransactions(repo, {
                        realmId,
                        type: 'Invoice'
                    });

                    const invoiceCountMap = new Map<string, number>();
                    for (const inv of invoices) {
                        if (inv.customerId) {
                            invoiceCountMap.set(inv.customerId, (invoiceCountMap.get(inv.customerId) ?? 0) + 1);
                        }
                    }

                    const enrichedCustomers = customers.map((c: any) => ({
                        ...c,
                        invoiceCount: invoiceCountMap.get(c.qbId) || 0
                    }));

                    yield enrichedCustomers;
                }
                return getCustomerStatsGenerator();
            })
            .withNormalization((batch: any[]) => {
                const normalized: any[] = [];
                const unscannable: any[] = [];

                batch.forEach(c => {
                    const result = CustomerRawSchema.safeParse(c);
                    if (result.success) {
                        normalized.push(result.data);
                    } else {
                        unscannable.push({
                            id: c.qbId || 'Unknown',
                            issue: 'CRITICAL_DATA_MISSING',
                            details: result.error.flatten(),
                            rawRecord: c
                        });
                    }
                });

                return { normalized, unscannable };
            })
            .withDetection((norm: { normalized: any[], unscannable: any[] }) => {
                const findings = norm.normalized.filter((c) => c.balance < 0 && c.invoiceCount === 0);
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((f) => {
                    const balance = f.balance;
                    const amountNum = Math.abs(balance);
                    const fingerprint = generateFingerprint([f.qbId, balance.toString()]);
                    const impactScore = Math.min(100, Math.round(30 * Math.min(2, amountNum / 1000)));

                    return {
                        id: f.qbId,
                        fingerprint,
                        impactScore,
                        amount: amountNum,
                        currency: 'USD',
                        metadata: {
                            qbId: f.qbId,
                            name: f.name || 'Unknown Customer',
                            balance: balance
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'Customer',
                            amount: amountNum,
                            balance: balance
                        }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.qbId,
                    label: `${f.metadata.name} - $${Math.abs(f.metadata.balance).toFixed(2)}`,
                    details: `Customer has a credit balance of $${Math.abs(f.metadata.balance).toFixed(2)} but has never been invoiced.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/customerdetail?realmId=${ctx.realmId}&nameId=${f.metadata.qbId}`
                }));

                const reportString = formatStandardReport({
                    title: 'Customer Credits Without Invoices',
                    items: displayItems,
                    recommendation: 'A customer credit without any invoice history might indicate that income was incorrectly recorded as a credit, or a payment was received for an invoice that was never created in QuickBooks.',
                    blindSpots: normErrors
                });

                return reportString;
            })
            .execute();
    }
}
