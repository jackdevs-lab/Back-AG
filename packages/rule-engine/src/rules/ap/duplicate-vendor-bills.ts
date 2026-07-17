//(production ready 05/01/2026)
import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { BillRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/duplicate-vendor-bills';
type RawBatchItem = {
    id: string;
    qbId: string;
    date: Date;
    amount: any;
    rawData: any;
    vendorId: string | null;
    customerId: string | null;
    syncToken: string | null;
};

type NormalizedBill = RawBatchItem & { qboData: z.infer<typeof BillRawSchema> };

type NormalizationResult = {
    normalized: NormalizedBill[];
    unscannable: any[];
};

type DuplicateGroup = {
    vendorId: string;
    docNumber: string;
    amount: any;
    currency: string;
    bills: NormalizedBill[];
};

type DetectionResult = {
    findings: DuplicateGroup[];
};

export class DuplicateVendorBillsRule implements IRule {
    id: RuleId = 'DUPLICATE_VENDOR_BILLS' as unknown as RuleId;
    name = 'Duplicate Vendor Bills';
    severity = 'HIGH' as const;
    description = 'Detects multiple bills from the same vendor with the same reference number and amount.';
    category = 'AP_ERRORS' as const;
    version = '2.0.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<RawBatchItem[], NormalizationResult, DetectionResult, EnrichedFinding>(
            ctx,
            this.id,
            this.name,
            this.version
        )
            .withData(async (repo, realmId) => {
                return transactionGenerator(repo, {
                    realmId,
                    type: 'Bill',
                    pageSize: 1000
                });
            })
            .withNormalization((batch: RawBatchItem[]) => {
                return normalizeTransactionBatch(batch, BillRawSchema) as NormalizationResult;
            })
            .withDetection((norm: NormalizationResult) => {
                const billGroups = new Map<string, NormalizedBill[]>();

                for (const bill of norm.normalized) {
                    const docNumber = bill.qboData.DocNumber?.trim().toUpperCase();
                    if (!docNumber) continue;

                    const vendor = bill.qboData.VendorRef?.value || bill.vendorId || 'NO_VENDOR';
                    const amount = Math.abs(Number(bill.qboData.Balance || bill.amount)).toFixed(2);
                    const currency = (bill.qboData.CurrencyRef?.value || 'USD').toUpperCase();

                    const key = `${vendor}|${docNumber}|${amount}|${currency}`;

                    if (!billGroups.has(key)) {
                        billGroups.set(key, []);
                    }
                    billGroups.get(key)!.push(bill);
                }

                const duplicates: DuplicateGroup[] = Array.from(billGroups.values())
                    .filter(group => group.length > 1)
                    .map(group => ({
                        vendorId: group[0].qboData.VendorRef?.value || group[0].vendorId || 'NO_VENDOR',
                        docNumber: group[0].qboData.DocNumber || 'UNKNOWN',
                        amount: group[0].qboData.Balance || group[0].amount,
                        currency: group[0].qboData.CurrencyRef?.value || 'USD',
                        bills: group
                    }));

                return { findings: duplicates };
            })
            .withEnrichment((detections: DetectionResult) => {
                return detections.findings.map((duplicate): EnrichedFinding => {
                    const billIds = duplicate.bills.map(b => b.qbId).sort();
                    const fingerprint = generateFingerprint([this.id, ...billIds]);

                    return {
                        id: fingerprint,
                        label: `Duplicate Bill for Vendor ${duplicate.vendorId}`,
                        date: duplicate.bills[0].date,
                        amount: duplicate.amount,
                        currency: duplicate.currency,
                        metadata: {
                            vendorId: duplicate.vendorId,
                            docNumber: duplicate.docNumber,
                            fingerprint: fingerprint,
                            duplicateCount: duplicate.bills.length
                        },
                        entities: duplicate.bills.map(b => ({
                            qbId: b.qbId,
                            date: b.date,
                            amount: b.qboData.Balance || b.amount
                        }))
                    };
                });
            })
            .withReporting((aggregatedReportData: any, ctx: RuleContext, allUnscannable: any[]) => {
                return formatReport(ctx.realmId, aggregatedReportData, allUnscannable);
            })
            .execute();
    }
}
