import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal, safeDate } from '../../core/shared/base-schemas';

const EntitySchema = z.object({ value: z.string().optional() }).passthrough();
const DepositLineDetailSchema = z.object({ Entity: EntitySchema.optional() }).passthrough();
const LineSchema = z.object({
    Amount: safeDecimal.optional(),
    DepositLineDetail: DepositLineDetailSchema.optional()
}).passthrough();

const DepositRawSchema = z.object({
    TotalAmt: safeDecimal.optional(),
    TxnDate: safeDate.optional(),
    CurrencyRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    Line: z.array(LineSchema).optional()
}).passthrough();

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof DepositRawSchema> })[];
    unscannable: any[]
};

export class DepositWithoutCustomerRule implements IRule {
    id: RuleId = 'DEPOSIT_WITHOUT_CUSTOMER' as unknown as RuleId;
    name = 'Deposit Without Customer Reference';
    severity = 'WARNING' as const;
    description = 'Detects bank deposits that are not linked to a customer on any of the line items.';
    category = 'BANK_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<any[], NormalizedBatch, { findings: any[] }, any>(
            ctx, this.id, this.name, this.version
        )
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - 2);
                return transactionGenerator(repo, { realmId, type: 'Deposit', lookbackDate });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, DepositRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((d) => {
                    const raw: any = d.qboData;
                    const lines = raw.Line || [];
                    return !lines.some((l: any) => l.DepositLineDetail?.Entity?.value);
                });
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((d) => {
                    const raw: any = d.qboData;
                    const amount = raw.TotalAmt || 0;
                    const date = raw.TxnDate || d.date;
                    return {
                        id: d.qbId,
                        fingerprint: generateFingerprint([d.qbId, amount.toString()]),
                        impactScore: Math.min(100, Math.round(30 * Math.min(2, amount / 1000))),
                        amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: { qbId: d.qbId },
                        entities: [{ id: d.qbId, type: 'Deposit', amount, date: new Date(date) }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.qbId,
                    label: `Deposit ${f.metadata.qbId} � $${f.amount.toFixed(2)}`,
                    details: `Deposit on ${f.date.toISOString().split('T')[0]} for $${f.amount.toFixed(2)} has no customer reference on any line.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/deposit?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
                }));
                return formatStandardReport({
                    title: 'Deposits Without Customer Reference',
                    items: displayItems,
                    recommendation: 'Standard revenue deposits must have a customer reference for accurate sales and profitability reporting. Locate these transactions and assign the correct customer.',
                    blindSpots: normErrors
                });
            })
            .execute();
    }
}
