//(production ready)
import { z } from 'zod';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch, fetchRuleConfig } from '../../core/shared/data-primitives';
import { BillRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/negative-ap-balance';

type NormalizedBill = any & { qboData: z.infer<typeof BillRawSchema> };
type NormalizationOutput = { normalized: NormalizedBill[]; unscannable: any[] };
type DetectionOutput = { findings: NormalizedBill[] };

export class NegativeApBalanceRule implements IRule {
    id: RuleId = 'NEGATIVE_AP_BALANCE' as unknown as RuleId;
    name = 'Negative Accounts Payable Balance';
    severity = 'WARNING' as const;
    description = 'Detects vendors or bills with a negative balance in Accounts Payable.';
    category = 'AP_ERRORS' as const;
    version = '3.4.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            any,
            NormalizationOutput,
            DetectionOutput,
            EnrichedFinding
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const config = await fetchRuleConfig(repo, realmId, this.id);
                const lookbackYears = (config?.json as any)?.lookbackYears ?? 3;
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - lookbackYears);

                return transactionGenerator(repo, {
                    realmId,
                    type: 'Bill',
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]): NormalizationOutput => {
                return normalizeTransactionBatch(batch, BillRawSchema);
            })
            .withDetection((norm: NormalizationOutput): DetectionOutput => {
                const threshold = 0.01;
                const sanitizedThreshold = -Math.abs(threshold);

                const findings = norm.normalized.filter((f: NormalizedBill) => {
                    const balance = f.qboData?.Balance;
                    return balance !== undefined && balance < sanitizedThreshold;
                });

                return { findings };
            })
            .withEnrichment((detected: DetectionOutput, ctx: RuleContext): EnrichedFinding[] => {
                return detected.findings.map((f: NormalizedBill): EnrichedFinding => {
                    const fingerprint = generateFingerprint([this.id, f.qbId]);
                    const amount = f.qboData.Balance;
                    const vendorName = f.qboData.VendorRef?.name || 'Unknown Vendor';

                    return {
                        id: f.qbId,
                        label: `Negative Balance on Bill ${f.qboData.DocNumber || f.qbId} for ${vendorName}`,
                        date: new Date(f.date),
                        amount: amount,
                        currency: f.qboData.CurrencyRef?.value || 'USD',
                        metadata: {
                            fingerprint,
                            vendorId: f.vendorId,
                            vendorName: vendorName,
                            docNumber: f.qboData.DocNumber
                        },
                        entities: [
                            {
                                id: f.vendorId,
                                type: 'Vendor',
                                balance: amount
                            }
                        ]
                    };
                });
            })
            .withReporting((reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatReport(reportData, ctx, normErrors);
            })
            .execute();
    }
}
