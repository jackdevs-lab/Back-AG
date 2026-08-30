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
    CustomerRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    DepositToAccountRef: z.object({ value: z.string().optional(), name: z.string().optional() }).passthrough().optional()
}).passthrough();

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof PaymentRawSchema> })[];
    unscannable: any[]
};

const UNDEPOSITED_FUNDS_NAMES = ['Undeposited Funds', 'Funds to Deposit'];

export class PaymentNotToUndepositedFundsRule implements IRule {
    id: RuleId = 'PAYMENT_NOT_TO_UNDEPOSITED_FUNDS' as unknown as RuleId;
    name = 'Payment Not To Undeposited Funds';
    severity = 'WARNING' as const;
    description = 'Detects payments that bypass the Undeposited Funds account and go directly to a bank account.';
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
                const findings = norm.normalized.filter((pay) => {
                    const raw: any = pay.qboData;
                    const depositAccountName = raw.DepositToAccountRef?.name || '';
                    if (!depositAccountName) return false;
                    // Flag payments going directly to a bank account, not Undeposited Funds
                    return !UNDEPOSITED_FUNDS_NAMES.some(n =>
                        depositAccountName.toLowerCase().includes(n.toLowerCase())
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
                    details: `Payment on ${f.date.toISOString().split('T')[0]} was deposited directly to "${f.metadata.depositedTo}" instead of Undeposited Funds.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/recvpayment?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
                }));
                return formatStandardReport({
                    title: 'Payments Bypassing Undeposited Funds',
                    items: displayItems,
                    recommendation: 'Routing payments directly to a bank account makes bank reconciliation difficult because you cannot group multiple payments into a single bank deposit to match your bank statement. Change the "Deposit To" field to "Undeposited Funds."',
                    blindSpots: normErrors
                });
            })
            .execute();
    }
}
