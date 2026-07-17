//(production ready )
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { generateFingerprint } from '../../core/shared/utils';
import { fetchRuleConfig, transactionGenerator, normalizeTransactionBatch, fetchTransactionsByQbIds } from '../../core/shared/data-primitives';
import { BillPaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { formatReport } from '../../core/report/orphaned-bill-payment';
import { z } from 'zod';

type RawTx = {
    id: string;
    qbId: string;
    date: Date;
    amount: any;
    rawData: any;
    vendorId: string | null;
    customerId: string | null;
    syncToken: string | null;
};

type BillPaymentData = z.infer<typeof BillPaymentRawSchema>;
type BillPaymentLine = NonNullable<BillPaymentData['Line']>[number];
type LinkedTxn = NonNullable<BillPaymentLine['LinkedTxn']>[number];

type NormTx = RawTx & { qboData: BillPaymentData };
type DetectedTx = NormTx & { missingBillIds: string[] };

type NormalizedBatch = { normalized: NormTx[]; unscannable: any[] };
type DetectionResult = { findings: DetectedTx[] };

export class OrphanedBillPaymentRule implements IRule {
    id: RuleId = 'ORPHANED_BILL_PAYMENT' as unknown as RuleId;
    name = 'Orphaned Bill Payments';
    severity = 'HIGH' as const;
    description = 'Detects bill payments linked to bills that no longer exist in QuickBooks.';
    category = 'AP_ERRORS' as const;
    version = '3.2.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<RawTx[], NormalizedBatch, DetectionResult, EnrichedFinding>(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const config = await fetchRuleConfig(repo, realmId, this.id);
                const lookbackDays = (config?.json as any)?.lookbackDays ?? 730;
                const lookbackDate = new Date();
                lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);

                return transactionGenerator(repo, {
                    realmId,
                    type: 'BillPayment',
                    lookbackDate,
                    pageSize: 1000,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: RawTx[]) => {
                return normalizeTransactionBatch(batch, BillPaymentRawSchema) as NormalizedBatch;
            })
            .withDetection(async (norm: NormalizedBatch) => {
                const payments = norm.normalized;
                const allBillIds = new Set<string>();

                for (const p of payments) {
                    const lines = p.qboData?.Line || [];
                    for (const line of lines) {
                        const links = line.LinkedTxn || [];
                        for (const link of links) {
                            if (link.TxnType === 'Bill' && link.TxnId) {
                                allBillIds.add(link.TxnId);
                            }
                        }
                    }
                }

                if (allBillIds.size === 0) {
                    return { findings: [] };
                }

                const existingBills = await fetchTransactionsByQbIds(ctx.repo, {
                    realmId: ctx.realmId,
                    qbIds: Array.from(allBillIds) as any[],
                    types: ['Bill']
                });

                const existingBillIds = new Set(existingBills.map((b: { qbId: string }) => b.qbId));

                const findings = payments.filter((p: NormTx) => {
                    const lines: BillPaymentLine[] = p.qboData?.Line || [];
                    const missingBillIds: string[] = [];

                    lines.forEach((line: BillPaymentLine) => {
                        const links: LinkedTxn[] = line.LinkedTxn || [];
                        links.forEach((link: LinkedTxn) => {
                            if (link.TxnType === 'Bill' && link.TxnId && !existingBillIds.has(link.TxnId)) {
                                missingBillIds.push(link.TxnId);
                            }
                        });
                    });

                    if (missingBillIds.length > 0) {
                        (p as DetectedTx).missingBillIds = missingBillIds;
                        return true;
                    }
                    return false;
                }) as DetectedTx[];

                return { findings };
            })
            .withEnrichment((det: DetectionResult): EnrichedFinding[] => {
                return det.findings.map((f: DetectedTx): EnrichedFinding => {
                    const fingerprint = generateFingerprint([this.id, f.qbId]);
                    const amount = f.qboData.TotalAmt || f.amount || 0;
                    const currency = f.qboData.CurrencyRef?.value || 'USD';
                    const vendorName = f.qboData.VendorRef?.name || 'Unidentified Vendor';

                    return {
                        id: f.qbId,
                        label: `${vendorName} - Payment`,
                        date: new Date(f.date),
                        amount: amount,
                        currency: currency,
                        metadata: {
                            fingerprint,
                            missingBillIds: f.missingBillIds,
                            vendorId: f.qboData.VendorRef?.value || f.vendorId
                        },
                        ...({ fingerprint }),
                        entities: [{
                            id: f.qbId,
                            type: 'BillPayment',
                            amount,
                            currency,
                            date: new Date(f.date)
                        }]
                    };
                });
            })
            .withReporting(async (reportData, context, normErrors) => {
                return formatReport(context.realmId, reportData, normErrors);
            })
            .execute();
    }
}
