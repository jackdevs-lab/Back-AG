import { Prisma } from '@qb-health/financial-model';
import { z } from 'zod';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { JournalEntryRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatSummary } from '../../core/report/ar-control-account-mismatch';
import { buildQboDeepLink } from '../../core/shared/deeplink';

type RawDataBatch = any[];
type NormalizedData = { normalized: z.infer<typeof JournalEntryRawSchema>[]; unscannable: any[] };
type DetectionData = { findings: any[] };
type EnrichedData = EnrichedFinding[];

export class ArControlAccountMismatchRule implements IRule {
    id: RuleId = 'AR_CONTROL_ACCOUNT_MISMATCH' as unknown as RuleId;
    name = 'AR Control Account Mismatch';
    severity = 'HIGH' as const;
    description = 'Flag discrepancies between the total of all individual customer balances and the Accounts Receivable control account balance on the Balance Sheet.';
    category = 'BALANCE' as const;
    version = '3.0.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const realmId = ctx.realmId;   // <-- captured for enrichment closure

        return new PipelineRunner<RawDataBatch, NormalizedData, DetectionData, EnrichedData>(
            ctx,
            this.id,
            this.name,
            this.version
        )
            .withData(async (repo, realmId) => {
                return transactionGenerator(repo, {
                    realmId,
                    type: 'JournalEntry',
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: RawDataBatch): NormalizedData => {
                return normalizeTransactionBatch(batch, JournalEntryRawSchema);
            })
            .withDetection((norm: NormalizedData): DetectionData => {
                const findings = norm.normalized.filter((item: any) => {
                    const lines = item.qboData?.Line || [];
                    return lines.some((line: any) => {
                        const detail = line.JournalEntryLineDetail;
                        const isArAccount = detail?.AccountRef?.name?.toLowerCase().includes('accounts receivable');
                        const hasCustomer = !!detail?.Entity?.EntityRef?.value;

                        return isArAccount && !hasCustomer;
                    });
                });

                return { findings };
            })
            .withEnrichment((det: DetectionData, ctx: RuleContext, norm: NormalizedData): EnrichedData => {
                return det.findings.map((f: any): EnrichedFinding => {
                    const lines = f.qboData?.Line || [];
                    const arLine = lines.find((line: any) => {
                        const detail = line.JournalEntryLineDetail;
                        return detail?.AccountRef?.name?.toLowerCase().includes('accounts receivable') &&
                            !detail?.Entity?.EntityRef?.value;
                    });

                    // --- CRITICAL FIX: Safely extract and convert amount ---
                    const rawAmount = arLine?.Amount || 0;
                    const plainExposureAmount = typeof rawAmount?.toNumber === 'function'
                        ? rawAmount.toNumber()
                        : Number(rawAmount || 0);

                    // Extract currency safely from the transaction
                    const currency = f.qboData?.CurrencyRef?.value || 'USD';

                    return {
                        id: f.qbId,
                        label: `Journal Entry ${f.qboData?.DocNumber || f.qbId}`,
                        date: f.date,

                        // Satisfies EnrichedFindingSchema (expects Prisma.Decimal)
                        amount: new Prisma.Decimal(plainExposureAmount),
                        currency: currency,

                        metadata: {
                            fingerprint: generateFingerprint([this.id, f.qbId]),

                            // --- NEW: Add these for database save & API ---
                            exposureAmount: plainExposureAmount,
                            currency: currency
                        },

                        // Entities — enriched with amount and type for better UI context
                        entities: [{
                            id: f.qbId,
                            type: 'JournalEntry',
                            amount: plainExposureAmount,
                            date: f.date
                        }],

                        // Deep link — journal entries live at /app/journal in QBO
                        deepLink: buildQboDeepLink('journal', ctx.realmId, f.qbId)
                    };
                });
            })
            .withReporting((reportData: any, ctx: RuleContext, unscannable: any[]) => {
                return formatSummary(reportData, unscannable);
            })
            .execute();
    }
}