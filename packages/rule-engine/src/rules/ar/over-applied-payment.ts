//(production ready)

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { PaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/over-applied-payments';
import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';

type PaymentRaw = z.infer<typeof PaymentRawSchema>;

type NormalizedItem = {
    qbId: string;
    date: string | Date;
    qboData: PaymentRaw;
    [key: string]: any
};

type PipelineEnrichedFinding = EnrichedFinding & {
    fingerprint: string;
    impactScore: number;
};

export class OverAppliedPaymentRule implements IRule {
    id: RuleId = 'OVER_APPLIED_PAYMENT' as unknown as RuleId;
    name = 'Over-Applied Customer Payment';
    severity = 'HIGH' as const;
    description = 'Detects customer payments where the total applied amount exceeds the payment value.';
    category = 'AR_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            any[],
            { normalized: NormalizedItem[]; unscannable: any[] },
            { findings: NormalizedItem[] },
            PipelineEnrichedFinding[]
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setDate(lookbackDate.getDate() - 730);

                return transactionGenerator(repo, {
                    realmId,
                    type: 'Payment',
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => {
                return normalizeTransactionBatch(batch, PaymentRawSchema);
            })
            .withDetection((norm) => {
                const findings = norm.normalized.filter((pay: NormalizedItem) => {
                    const raw = pay.qboData;
                    if (!Array.isArray(raw.Line) || raw.Line.length === 0) return false;

                    const totalApplied = raw.Line.reduce((sum: number, l: any) => sum + (l.Amount || 0), 0);
                    const totalAmt = raw.TotalAmt || 0;

                    return totalApplied > totalAmt + 0.01;
                });

                return { findings };
            })
            .withEnrichment((detected): PipelineEnrichedFinding[] => {
                return detected.findings.map((f: NormalizedItem): PipelineEnrichedFinding => {
                    const raw = f.qboData;
                    const amountValue = raw.TotalAmt || 0;

                    const amount = new Prisma.Decimal(amountValue);

                    const totalApplied = (raw.Line || []).reduce((sum: number, l: any) => sum + (l.Amount || 0), 0);
                    const variance = totalApplied - amountValue;
                    const dateSource = (raw as any).TxnDate || f.date;
                    const date = new Date(dateSource as string | number | Date);

                    const fingerprint = generateFingerprint([this.id, f.qbId]);
                    const impactScore = Math.min(100, Math.round(50 * Math.min(2, variance / 500)));

                    return {
                        id: f.qbId,
                        label: `Payment ${f.qbId}`,
                        date: date,
                        amount: amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        fingerprint,
                        impactScore,
                        metadata: {
                            customerId: raw.CustomerRef?.value,
                            qbId: f.qbId,
                            totalApplied,
                            variance,
                            impactScore,
                            fingerprint
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'Payment',
                            amount: amountValue,
                            appliedAmount: totalApplied,
                            date: date
                        }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatReport(reportData, ctx, normErrors);
            })
            .execute();
    }
}
