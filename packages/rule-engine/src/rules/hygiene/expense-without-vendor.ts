import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal, safeDate } from '../../core/shared/base-schemas';

const ExpenseRawSchema = z.object({
    TotalAmt: safeDecimal.optional(),
    TxnDate: safeDate.optional(),
    CurrencyRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    EntityRef: z.object({ value: z.string().optional(), type: z.string().optional() }).passthrough().optional(),
    VendorRef: z.object({ value: z.string().optional() }).passthrough().optional()
}).passthrough();

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof ExpenseRawSchema> })[];
    unscannable: any[]
};

export class ExpenseWithoutVendorRule implements IRule {
    id: RuleId = 'EXPENSE_WITHOUT_VENDOR' as unknown as RuleId;
    name = 'Expense Without Vendor';
    severity = 'WARNING' as const;
    description = 'Detects expenses that are not associated with any vendor.';
    category = 'HYGIENE' as const;
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
                    type: ['Purchase', 'Check'],
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, ExpenseRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((txn) => {
                    const raw: any = txn.qboData;
                    const hasVendor = raw.VendorRef?.value || raw.EntityRef?.value;
                    return !hasVendor;
                });
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((txn) => {
                    const raw: any = txn.qboData;
                    const amount = raw.TotalAmt || 0;
                    const date = raw.TxnDate || txn.date;
                    return {
                        id: txn.qbId,
                        fingerprint: generateFingerprint([txn.qbId]),
                        impactScore: 35,
                        amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: { qbId: txn.qbId, txnType: txn.type },
                        entities: [{ id: txn.qbId, type: txn.type, amount, date: new Date(date) }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                const displayItems = reportData.findingsForDisplay.map((f: any) => ({
                    id: f.metadata.qbId,
                    label: `${f.metadata.txnType} ${f.metadata.qbId} � $${f.amount.toFixed(2)}`,
                    details: `${f.metadata.txnType} on ${f.date.toISOString().split('T')[0]} for $${f.amount.toFixed(2)} has no vendor assigned.`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/expense?realmId=${ctx.realmId}&txnId=${f.metadata.qbId}`
                }));
                return formatStandardReport({
                    title: 'Expenses Without Vendors',
                    items: displayItems,
                    recommendation: 'Expenses without vendors make it impossible to track spending by supplier or generate accurate 1099 reports. Assign the correct vendor to each of these transactions.',
                    blindSpots: normErrors
                });
            })
            .execute();
    }
}
