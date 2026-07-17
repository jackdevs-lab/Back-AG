//(production ready)
import { Prisma } from '@qb-health/financial-model';
import { z } from 'zod';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { JournalEntryRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { isMismatch } from '../../core/detect/ap-control-account-mismatch';
import { formatReport } from '../../core/report/ap-control-account-mismatch';

type JournalEntryRaw = z.infer<typeof JournalEntryRawSchema>;
type TransactionBatchItem = { qbId: string; date: Date; amount: Prisma.Decimal; rawData: any };
type NormalizedItem = TransactionBatchItem & { qboData: JournalEntryRaw };
type NormResult = { normalized: NormalizedItem[]; unscannable: any[] };
type DetectionResult = { findings: { qbId: string; date: Date; variance: Prisma.Decimal; rawData: any }[] };

function calculateImpactScore(variance: number): number {
    return Math.min(100, Math.round(50 * Math.min(2, variance / 5000)));
}

export class ApControlAccountMismatchRule implements IRule {
    id: RuleId = 'AP_CONTROL_ACCOUNT_MISMATCH' as unknown as RuleId;
    name = 'AP Control Account Mismatch';
    severity = 'HIGH' as const;
    description = 'Detects discrepancies between open vendor bills and the Accounts Payable control account balance.';
    category = 'BALANCE' as const;
    version = '3.0.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            TransactionBatchItem[],
            NormResult,
            DetectionResult,
            EnrichedFinding[]
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                return transactionGenerator(repo, {
                    realmId,
                    type: 'JournalEntry'
                });
            })
            .withNormalization((batch: TransactionBatchItem[]) => {
                return normalizeTransactionBatch(batch, JournalEntryRawSchema) as NormResult;
            })
            .withDetection((norm: NormResult) => {
                const findings: DetectionResult['findings'] = [];
                const tolerance = new Prisma.Decimal('1.00');

                for (const item of norm.normalized) {
                    const je = item.qboData;
                    let varianceAmount = new Prisma.Decimal(0);
                    let isSuspicious = false;

                    if (je.Line) {
                        for (const line of je.Line) {
                            const detail = line.JournalEntryLineDetail;
                            if (detail?.AccountRef?.name?.includes('Accounts Payable')) {
                                if (!detail.Entity || detail.Entity.Type !== 'Vendor') {
                                    isSuspicious = true;
                                    varianceAmount = varianceAmount.add(new Prisma.Decimal(line.Amount || 0));
                                }
                            }
                        }
                    }

                    if (isSuspicious && isMismatch(varianceAmount, tolerance)) {
                        findings.push({
                            qbId: item.qbId,
                            date: item.date,
                            variance: varianceAmount,
                            rawData: je
                        });
                    }
                }
                return { findings };
            })
            .withEnrichment((det: DetectionResult, ctx: RuleContext): EnrichedFinding[] => {
                if (!det.findings || det.findings.length === 0) return [];

                return det.findings.map((f) => ({
                    id: f.qbId,
                    label: 'Direct AP Journal Entry',
                    date: f.date ? new Date(f.date) : new Date(),
                    amount: f.variance,
                    currency: 'USD',
                    fingerprint: generateFingerprint([this.id, f.qbId]),
                    metadata: {
                        impactScore: calculateImpactScore(f.variance.toNumber())
                    },
                    entities: [f.rawData]
                }));
            })
            .withReporting((reportData: any, ctx: RuleContext, unscannable: any[]) => {
                return formatReport(reportData, unscannable);
            })
            .execute();
    }
}
