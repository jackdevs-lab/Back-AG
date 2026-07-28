//(production ready)
import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { fetchCustomers } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal } from '../../core/shared/base-schemas';

const CustomerRawSchema = z.object({
    qbId: z.string(),
    name: z.string().nullable().optional(),
    balance: safeDecimal
}).passthrough();

export class NegativeARBalanceRule implements IRule {
    id: RuleId = 'NEGATIVE_AR_BALANCE' as unknown as RuleId;
    name = 'Negative AR Balance';
    severity = 'WARNING' as const;
    description = 'Detects customers with an overall negative Accounts Receivable balance.';
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
                async function* getCustomerBalancesGenerator() {
                    const customers = await fetchCustomers(repo, { realmId, active: true });
                    yield customers;
                }
                return getCustomerBalancesGenerator();
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
                const findings = norm.normalized.filter((c) => c.balance < 0);
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
                    label: `${f.metadata.name} - $${f.metadata.balance.toFixed(2)}`,
                    details: `Customer has a negative AR balance of $${f.metadata.balance.toFixed(2)}. This usually indicates unapplied payments, overpayments, or missing invoices.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/customerdetail?realmId=${ctx.realmId}&nameId=${f.metadata.qbId}`
                }));

                const reportString = formatStandardReport({
                    title: 'Customers with Negative AR Balance',
                    items: displayItems,
                    recommendation: 'A negative AR balance means you owe the customer money, or you have received payment but not yet invoiced them. Review these customer accounts to apply open payments or issue refunds.',
                    blindSpots: normErrors
                });

                return reportString;
            })
            .execute();
    }
}
