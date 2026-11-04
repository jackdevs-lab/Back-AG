// rule.ts
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { CreditMemoRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatSummary } from '../../core/report/unapplied-credit-memos';
import { buildQboDeepLink } from '../../core/shared/deeplink';
import { Prisma } from '@qb-health/financial-model';


type NormalizedBatch = {
    normalized: (any & { qboData: any })[];
    unscannable: any[];
};

export class UnappliedCreditMemosRule implements IRule {
    id: RuleId = 'UNAPPLIED_CREDIT_MEMO' as unknown as RuleId;
    name = 'Unapplied Customer Credit Memos';
    severity = 'WARNING' as const;
    description = 'Detects customer credit memos that have a remaining balance and haven\'t been fully applied to invoices.';
    category = 'AR_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const realmId = ctx.realmId;
        return new PipelineRunner<
            any[],
            NormalizedBatch,
            { findings: any[] },
            EnrichedFinding
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setDate(lookbackDate.getDate() - 730);

                return transactionGenerator(repo, {
                    realmId,
                    type: 'CreditMemo',
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => {
                return normalizeTransactionBatch(batch, CreditMemoRawSchema);
            })
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((memo) => {
                    const raw = memo.qboData;
                    if (!raw.Balance) return false;
                    return raw.Balance > 0;
                });

                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((f) => {
                    const raw = f.qboData;
                    const date = raw.TxnDate || f.date;
                    const currency = raw.CurrencyRef?.value || 'USD';

                    // --- CRITICAL FIX: Safely extract and convert amounts ---
                    // The exposure is the unapplied balance, not the total amount
                    const rawBalance = raw.Balance || 0;
                    const plainExposureAmount = typeof rawBalance?.toNumber === 'function'
                        ? rawBalance.toNumber()
                        : Number(rawBalance || 0);

                    // Also extract total amount for reference
                    const rawTotalAmt = raw.TotalAmt || 0;
                    const plainTotalAmount = typeof rawTotalAmt?.toNumber === 'function'
                        ? rawTotalAmt.toNumber()
                        : Number(rawTotalAmt || 0);

                    const fingerprint = generateFingerprint([this.id, f.qbId]);
                    const impactScore = Math.min(100, Math.round(30 * Math.min(2, plainExposureAmount / 1000)));

                    return {
                        id: f.qbId,
                        label: `Credit Memo ${f.qbId}`,
                        date: new Date(date),

                        // Satisfies EnrichedFindingSchema (expects Prisma.Decimal)
                        amount: new Prisma.Decimal(plainExposureAmount),
                        currency: currency,

                        fingerprint,
                        impactScore,
                        metadata: {
                            customerId: raw.CustomerRef?.value,
                            qbId: f.qbId,
                            unappliedAmount: plainExposureAmount,
                            originalAmount: plainTotalAmount,

                            // --- NEW: Add these for database save & API ---
                            exposureAmount: plainExposureAmount,
                            currency: currency
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'CreditMemo',
                            amount: plainExposureAmount, // Use plain number for clean JSON
                            unappliedAmount: plainExposureAmount,
                            date: new Date(date)
                        }],
                        deepLink: buildQboDeepLink('creditmemo', realmId, f.qbId)
                    } as unknown as EnrichedFinding & { fingerprint: string; impactScore: number };
                });
            })
            .withReporting((reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatSummary(reportData, normErrors);
            })
            .execute();
    }
}