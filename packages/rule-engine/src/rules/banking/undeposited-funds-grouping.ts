import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal, safeDate } from '../../core/shared/base-schemas';

const PaymentRawSchema = z.object({
    TotalAmt: safeDecimal.optional(),
    TxnDate: safeDate.optional(),
    CurrencyRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    DepositToAccountRef: z.object({ value: z.string().optional(), name: z.string().optional() }).passthrough().optional(),
    CustomerRef: z.object({ value: z.string().optional() }).passthrough().optional()
}).passthrough();

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof PaymentRawSchema> })[];
    unscannable: any[]
};

const UNDEPOSITED_FUNDS_NAMES = ['Undeposited Funds', 'Funds to Deposit'];

export class UndepositedFundsGroupRule implements IRule {
    id: RuleId = 'UNDEPOSITED_FUNDS_GROUPING' as unknown as RuleId;
    name = 'Undeposited Funds Grouping';
    severity = 'WARNING' as const;
    description = 'Ensures customer payments are routed through "Undeposited Funds" for proper bank matching.';
    category = 'BANK_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<any[], NormalizedBatch, { findings: any[] }, any>(
            ctx, this.id, this.name, this.version
        )
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - 2);
                return transactionGenerator(repo, {
                    realmId,
                    type: ['Payment', 'SalesReceipt'],
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, PaymentRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                // Flag payments deposited directly to a bank account (bypassing Undeposited Funds)
                const findings = norm.normalized.filter((pay) => {
                    const raw: any = pay.qboData;
                    const accountName = raw.DepositToAccountRef?.name || '';
                    // If there's no deposit account ref or it IS Undeposited Funds, that's fine
                    if (!accountName) return false;
                    return !UNDEPOSITED_FUNDS_NAMES.some(n =>
                        accountName.toLowerCase().includes(n.toLowerCase())
                    );
                });
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((pay) => {
                    const raw: any = pay.qboData;
                    const amount = raw.TotalAmt || 0;
                    const date = raw.TxnDate || pay.date;
                    return {
                        id: pay.qbId,
                        fingerprint: generateFingerprint([pay.qbId]),
                        impactScore: 40,
                        amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: {
                            qbId: pay.qbId,
                            customerId: raw.CustomerRef?.value,
                            depositedTo: raw.DepositToAccountRef?.name
                        },
                        entities: [{ id: pay.qbId, type: 'Payment', amount, date: new Date(date) }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.qbId,
                    label: `Payment ${f.metadata.qbId} � $${f.amount.toFixed(2)}`,
                    details: `Payment deposited directly to "${f.metadata.depositedTo}" instead of routing through Undeposited Funds first.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/recvpayment?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
                }));
                return formatStandardReport({
                    title: 'Payments Bypassing Undeposited Funds',
                    items: displayItems,
                    recommendation: 'Routing payments directly to a bank account makes it harder to match them to bank deposits during reconciliation. Set the "Deposit To" field to "Undeposited Funds" and then create a grouped Bank Deposit.',
                    blindSpots: normErrors
                });
            })
            .execute();
    }
}
