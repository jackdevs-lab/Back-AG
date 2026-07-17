//(production ready)
import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, fetchRuleConfig, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { BillRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/bill-without-vendor';

type RawBatch = any[];
type NormalizedBill = any & { qboData: z.infer<typeof BillRawSchema> };
type NormalizedBatch = { normalized: NormalizedBill[], unscannable: any[] };
type DetectionOutput = { findings: NormalizedBill[] };

export class BillWithoutVendorRule implements IRule {
    id: RuleId = 'BILL_WITHOUT_VENDOR' as unknown as RuleId;
    name = 'Bill Without Vendor';
    severity = 'HIGH' as const;
    description = 'Detects bills that are not assigned to any vendor.';
    category = 'AP_ERRORS' as const;
    version = '1.0.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<RawBatch, NormalizedBatch, DetectionOutput, EnrichedFinding[]>(
            ctx,
            this.id,
            this.name,
            this.version
        )
            .withData(async (repo, realmId) => {
                const config = await fetchRuleConfig(repo, realmId, this.id);
                const lookbackDays = (config?.json as any)?.lookbackDays ?? 730;
                const lookbackDate = new Date();
                lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

                return transactionGenerator(repo, {
                    realmId,
                    type: 'Bill',
                    lookbackDate,
                    pageSize: 1000
                });
            })
            .withNormalization((batch: RawBatch) => {
                return normalizeTransactionBatch(batch, BillRawSchema) as NormalizedBatch;
            })
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((bill) => {
                    const vendorId = bill.vendorId;
                    if (!vendorId) return true;

                    const normalizedVendorId = vendorId.trim();
                    return normalizedVendorId === '' || normalizedVendorId === 'NoVendor';
                });

                return { findings };
            })
            .withEnrichment((det: DetectionOutput): EnrichedFinding[] => {
                return det.findings.map((f) => {
                    const fingerprint = generateFingerprint([this.id, f.qbId]);
                    const amount = f.amount?.toNumber ? f.amount.toNumber() : Number(f.amount || 0);

                    return {
                        id: f.qbId,
                        label: `Bill ${f.qbId}`,
                        date: new Date(f.date),
                        amount: amount,
                        currency: f.qboData?.CurrencyRef?.value || 'USD',
                        fingerprint: fingerprint,
                        impactScore: 10,
                        metadata: {
                            docNumber: f.qboData?.DocNumber,
                            lastUpdated: f.qboData?.MetaData?.LastUpdatedTime
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'Bill',
                            amount: amount,
                            currency: f.qboData?.CurrencyRef?.value || 'USD',
                            date: f.date
                        }]
                    };
                });
            })
            .withReporting((reportData: any, ctx: RuleContext, unscannable: any[]) => {
                return formatReport(ctx.realmId, reportData, unscannable);
            })
            .execute();
    }
}
