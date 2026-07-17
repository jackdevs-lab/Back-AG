// rule/orchestrator/index.ts (version production)
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch, fetchVendorsByQbIds } from '../../core/shared/data-primitives';
import { BillPaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/bill-payment-without-bill';
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
                const vendorIds = [...new Set(reportData.findingsForDisplay.map((e: any) => e.metadata?.vendorId).filter(Boolean))] as string[];

                let vendorMap = new Map<string, string>();
                if (vendorIds.length > 0) {
                    const vendors = await fetchVendorsByQbIds(ctx.repo, { realmId: ctx.realmId, vendorQbIds: vendorIds as any[] });
                    vendorMap = new Map(vendors.map((v: any) => [String(v.qbId), String(v.name)]));
                }

                const enrichedDisplay = reportData.findingsForDisplay.map((f: any) => ({
                    ...f,
                    vendorName: vendorMap.get(f.metadata?.vendorId) || 'Unidentified Vendor'
                }));

                return formatReport(ctx.realmId, { ...reportData, findingsForDisplay: enrichedDisplay }, normErrors);
            })
            .execute();
    }
}
