// rule.ts
import { z } from 'zod';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch, fetchVendorsByQbIds } from '../../core/shared/data-primitives';
import { VendorCreditRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { RuleContext, IRule, RuleExecutionResult, RuleId } from '../../types';
import { formatSummary } from '../../core/report/vendor-credits-not-applied';
import { buildQboDeepLink } from '../../core/shared/deeplink';
import { Prisma } from '@qb-health/financial-model';


export class VendorCreditsNotAppliedRule implements IRule {
    id: RuleId = 'VENDOR_CREDIT_NOT_APPLIED' as unknown as RuleId;
    name = 'Unapplied Vendor Credits';
    severity = 'WARNING' as const;
    description = 'Detects vendor credits with a significant unapplied balance.';
    category = 'AP_ERRORS' as const;
    version = '3.1.2';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        const realmId = ctx.realmId;
        return new PipelineRunner<
            any,
            { normalized: z.infer<typeof VendorCreditRawSchema>[], unscannable: any[] },
            { findings: any[] },
            (EnrichedFinding & { fingerprint: string })[]
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                return transactionGenerator(repo, {
                    realmId,
                    type: 'VendorCredit',
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => {
                return normalizeTransactionBatch(batch, VendorCreditRawSchema);
            })
            .withDetection((norm) => {
                const threshold = 0.01;

                const findings = norm.normalized.filter((c: any) => {
                    const balance = c.qboData.Balance || 0;
                    return Math.abs(balance) >= threshold;
                });
                return { findings };
            })
            .withEnrichment(async (detections, ctx: RuleContext) => {
                const findings = detections.findings;
                const vendorIds = [...new Set(findings.map((f: any) => f.vendorId).filter(Boolean))] as string[];

                const vendors = vendorIds.length > 0
                    ? await fetchVendorsByQbIds(ctx.repo, { realmId: ctx.realmId, vendorQbIds: vendorIds as any[] })
                    : [];
                const vendorMap = new Map(vendors.map((v: any) => [v.qbId, v.name]));

                const enriched: (EnrichedFinding & { fingerprint: string })[] = findings.map((f: any) => {
                    const vendorName = vendorMap.get(f.vendorId) || 'Unknown Vendor';
                    const currency = f.qboData.CurrencyRef?.value || 'USD';
                    const fingerprint = generateFingerprint([this.id, f.qbId]);

                    // --- CRITICAL FIX: Safely extract and convert amount (use absolute value for exposure) ---
                    const rawBalance = f.qboData.Balance || 0;
                    const plainExposureAmount = typeof rawBalance?.toNumber === 'function'
                        ? Math.abs(rawBalance.toNumber())
                        : Math.abs(Number(rawBalance || 0));

                    return {
                        id: f.qbId,
                        label: `${vendorName} - Unapplied Credit`,
                        date: f.date,

                        // Satisfies EnrichedFindingSchema (expects Prisma.Decimal)
                        amount: new Prisma.Decimal(plainExposureAmount),
                        currency: currency,

                        fingerprint,
                        metadata: {
                            fingerprint,
                            vendorId: f.vendorId,
                            vendorName: vendorName,

                            // --- NEW: Add these for database save & API ---
                            exposureAmount: plainExposureAmount,
                            currency: currency
                        },
                        entities: [{
                            id: f.qbId,
                            vendorId: f.vendorId,
                            unappliedBalance: plainExposureAmount, // Use plain number for clean JSON
                            currency: currency,
                            date: f.date
                        }],
                        deepLink: buildQboDeepLink('vendorcredit', realmId, f.qbId)
                    };
                });

                return enriched;
            })
            .withReporting((aggregatedData, ctx: RuleContext, unscannable: any[]) => {
                return formatSummary(aggregatedData, unscannable);
            })
            .execute();
    }
}