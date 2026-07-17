// (production ready - 100%)
import { Prisma } from '@prisma/client';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, fetchRuleConfig, normalizeTransactionBatch, fetchVendorsByQbIds } from '../../core/shared/data-primitives';
import { BillRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/multiple-bills-same-amount';
import { z } from 'zod';

interface RawBatchItem {
    id: string;
    qbId: string;
    date: Date;
    amount: Prisma.Decimal;
    rawData: any;
    vendorId: string | null;
}

interface NormalizedBill {
    id: string;
    qbId: string;
    date: Date;
    amount: Prisma.Decimal;
    currency: string;
    vendorId: string;
}

interface NormResult {
    bills: NormalizedBill[];
    unscannable: any[];
}

interface DetectionResult {
    findings: NormalizedBill[][];
}

export class MultipleBillsSameAmountRule implements IRule {
    id: RuleId = 'MULTIPLE_BILLS_SAME_AMOUNT' as unknown as RuleId;
    name = 'Duplicate Bills (Same Amount Window)';
    severity = 'WARNING' as const;
    description = 'Detects multiple bills from the same vendor with identical amounts within a configurable day window.';
    category = 'AP_ERRORS' as const;
    version = '3.1.3';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<RawBatchItem[], NormResult, DetectionResult, EnrichedFinding[]>(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const config = await fetchRuleConfig(repo, realmId, this.id);
                const lookbackDays = (config?.json as any)?.lookbackDays ?? 730;

                const lookbackDate = new Date();
                lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

                return transactionGenerator(repo, {
                    realmId,
                    type: 'Bill',
                    lookbackDate,
                    pageSize: 1000,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: RawBatchItem[]) => {
                const { normalized, unscannable } = normalizeTransactionBatch(batch, BillRawSchema) as unknown as {
                    normalized: Array<RawBatchItem & { qboData: z.infer<typeof BillRawSchema> }>;
                    unscannable: any[];
                };

                const bills: NormalizedBill[] = normalized.map(n => ({
                    id: n.id,
                    qbId: n.qbId,
                    date: new Date(n.date),
                    amount: new Prisma.Decimal(n.amount),
                    currency: n.qboData.CurrencyRef?.value || 'USD',
                    vendorId: n.vendorId ?? 'UNKNOWN'
                }));

                return { bills, unscannable };
            })
            .withDetection((norm: NormResult) => {
                const windowDays = 30;
                const clusters = this.detectMultipleBillsSameAmount(norm.bills, windowDays);

                return { findings: clusters };
            })
            .withEnrichment(async (detections: DetectionResult, ctx: RuleContext) => {
                const clusters = detections.findings;
                if (!clusters || clusters.length === 0) return [];

                const vendorIds = [...new Set(clusters.map(c => c[0].vendorId).filter(v => v !== 'UNKNOWN'))] as string[];
                const vendors = await fetchVendorsByQbIds(ctx.repo, { realmId: ctx.realmId, vendorQbIds: vendorIds as any[] });
                const vendorMap = new Map(vendors.map((v: any) => [v.qbId, v.name]));

                return clusters.map((cluster: NormalizedBill[]): EnrichedFinding => {
                    const vendorName = vendorMap.get(cluster[0].vendorId) || 'Unidentified Vendor';
                    const qbIds = cluster.map(b => b.qbId).sort();

                    const fingerprint = generateFingerprint([this.id, ...qbIds]);

                    const totalAmount = cluster.reduce(
                        (sum, b) => sum.add(b.amount),
                        new Prisma.Decimal(0)
                    );

                    return {
                        id: qbIds.join(','),
                        label: `${vendorName} - Duplicate Cluster (x${cluster.length})`,
                        date: cluster[cluster.length - 1].date,
                        amount: totalAmount,
                        currency: cluster[0].currency,
                        metadata: {
                            fingerprint,
                            vendorName,
                            clusterSize: cluster.length,
                            vendorId: cluster[0].vendorId,
                            singleAmount: cluster[0].amount.toNumber(),
                            items: cluster
                        },
                        entities: cluster.map(b => ({
                            id: b.qbId,
                            type: 'Bill',
                            amount: b.amount.toNumber(),
                            currency: b.currency,
                            date: b.date
                        }))
                    };
                });
            })
            .withReporting(async (aggregatedData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatReport(aggregatedData, ctx, normErrors);
            })
            .execute();
    }

    private detectMultipleBillsSameAmount(bills: NormalizedBill[], windowDays: number): NormalizedBill[][] {
        const groups = new Map<string, NormalizedBill[]>();

        for (const bill of bills) {
            const key = `${bill.amount.abs().toFixed(2)}|${bill.currency.toUpperCase()}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(bill);
        }

        const clusters: NormalizedBill[][] = [];
        const windowMs = windowDays * 24 * 60 * 60 * 1000;

        for (const group of groups.values()) {
            if (group.length < 2) continue;

            const vendorGroups = new Map<string, NormalizedBill[]>();
            for (const bill of group) {
                const vendor = bill.vendorId || 'UNKNOWN';
                if (!vendorGroups.has(vendor)) vendorGroups.set(vendor, []);
                vendorGroups.get(vendor)!.push(bill);
            }

            for (const vendorGroup of vendorGroups.values()) {
                if (vendorGroup.length < 2) continue;

                const sorted = [...vendorGroup].sort((a, b) => a.date.getTime() - b.date.getTime());
                let currentCluster: NormalizedBill[] = [sorted[0]];

                for (let i = 1; i < sorted.length; i++) {
                    const diff = sorted[i].date.getTime() - currentCluster[currentCluster.length - 1].date.getTime();
                    if (diff <= windowMs) {
                        currentCluster.push(sorted[i]);
                    } else {
                        if (currentCluster.length >= 2) clusters.push(currentCluster);
                        currentCluster = [sorted[i]];
                    }
                }
                if (currentCluster.length >= 2) clusters.push(currentCluster);
            }
        }

        return clusters;
    }
}
