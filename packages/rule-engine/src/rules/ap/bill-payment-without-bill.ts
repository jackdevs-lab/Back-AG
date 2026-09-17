import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { BillPaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatSummary } from '../../core/report/bill-payment-without-bill';
import { z } from 'zod';

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof BillPaymentRawSchema> })[];
    unscannable: any[]
};

export class BillPaymentWithoutBillRule implements IRule {
    id: RuleId = 'BILL_PAYMENT_WITHOUT_BILL' as unknown as RuleId;
    name = 'Bill Payment Without Bill';
    severity = 'WARNING' as const;
    description = 'Detects bill payments that are not linked to any bills.';
    category = 'AP_ERRORS' as const;
    version = '1.0.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            any[],
            NormalizedBatch,
            { findings: any[] },
            EnrichedFinding
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                return transactionGenerator(repo, {
                    realmId,
                    type: 'BillPayment',
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => {
                return normalizeTransactionBatch(batch, BillPaymentRawSchema);
            })
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((item) => {
                    const rawData = item.qboData;

                    if (!rawData || typeof rawData !== 'object' || !Array.isArray(rawData.Line)) {
                        return true;
                    }

                    const hasBillLink = rawData.Line.some((line: any) => {
                        if (!Array.isArray(line.LinkedTxn)) return false;
                        return line.LinkedTxn.some((link: any) =>
                            link?.TxnType?.toLowerCase() === 'bill'
                        );
                    });

                    return !hasBillLink;
                });
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }): EnrichedFinding[] => {
                return detected.findings.map((f: any) => {
                    const amount = f.amount?.toNumber ? f.amount.toNumber() : Number(f.amount || 0);
                    const fingerprint = generateFingerprint([this.id, f.qbId || 'unknown']);

                    const impactScore = Math.min(100, Math.round(20 * Math.min(5, amount / 500)));

                    return {
                        id: f.id || f.qbId,
                        label: `Unlinked Bill Payment ${f.qbId}`,
                        date: f.date,
                        amount: amount,
                        currency: f.qboData?.CurrencyRef?.value || 'USD',
                        fingerprint,
                        impactScore,
                        metadata: {
                            qbId: f.qbId,
                            vendorId: f.vendorId,
                            fingerprint: fingerprint,
                            auditMetadata: {
                                timestamp: new Date().toISOString(),
                                scoreContribution: impactScore
                            }
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'BillPayment',
                            amount: amount,
                            currency: f.qboData?.CurrencyRef?.value || 'USD',
                            date: f.date,
                            currencyConfidence: 1,
                            vendorConfidence: f.vendorId ? 1 : 0,
                            auditMetadata: {
                                scoreContribution: impactScore
                            }
                        }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatSummary(reportData, normErrors);
            })
            .execute();
    }
}