
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { formatStandardReport } from '../../core/shared/report-utils';
import { generateFingerprint } from '../../core/shared/utils';
import { safeDecimal, safeDate } from '../../core/shared/base-schemas';
import { z } from 'zod';

const TxnRawSchema = z.object({
    TotalAmt: safeDecimal.optional(),
    TxnDate: safeDate.optional(),
    CurrencyRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    Line: z.array(z.object({
        AccountBasedExpenseLineDetail: z.object({
            AccountRef: z.object({ value: z.string().optional(), name: z.string().optional() }).passthrough().optional()
        }).passthrough().optional(),
        SalesItemLineDetail: z.object({
            ItemRef: z.object({ value: z.string().optional() }).passthrough().optional()
        }).passthrough().optional()
    }).passthrough()).optional()
}).passthrough();

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof TxnRawSchema> })[];
    unscannable: any[]
};

// These account names indicate "uncategorized" in QBO
const UNCATEGORIZED_ACCOUNT_NAMES = [
    'uncategorized expense',
    'uncategorized asset',
    'uncategorized income',
    'ask my accountant'
];

export class UncategorizedTransactionsRule implements IRule {
    id: RuleId = 'UNCATEGORIZED_TRANSACTION' as unknown as RuleId;
    name = 'Uncategorized Transactions';
    severity = 'CRITICAL' as const;
    description = 'Detects transactions posted to uncategorized or placeholder accounts.';
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
                    type: ['Bill', 'Purchase', 'Check', 'JournalEntry'],
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, TxnRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((txn) => {
                    const raw: any = txn.qboData;
                    const lines: any[] = raw.Line || [];
                    return lines.some((l: any) => {
                        const accountName = (
                            l.AccountBasedExpenseLineDetail?.AccountRef?.name || ''
                        ).toLowerCase().trim();
                        return UNCATEGORIZED_ACCOUNT_NAMES.some(u => accountName.includes(u));
                    });
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
                        impactScore: 90,
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
                    details: `${f.metadata.txnType} on ${f.date.toISOString().split('T')[0]} is posted to an uncategorized account ("Ask My Accountant" or similar).`,
                    deepLink: `https://sandbox.qbo.intuit.com/app/reportv2?reportName=GeneralLedger&realmId=${ctx.realmId}`
                }));
                return formatStandardReport({
                    title: 'Uncategorized Transactions',
                    items: displayItems,
                    recommendation: 'Transactions in "Uncategorized Expense," "Ask My Accountant," or similar accounts are placeholders that distort your Profit & Loss and Balance Sheet. Categorize each one to the correct account as soon as possible.',
                    blindSpots: normErrors
                });
            })
            .execute();
    }
}
