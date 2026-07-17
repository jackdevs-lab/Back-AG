//(production ready version)
import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { BillRawSchema, PurchaseRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/expense-instead-of-bill-payment';

const ExpenseVsBillSchema = z.union([BillRawSchema, PurchaseRawSchema]);
type TransactionType = z.infer<typeof ExpenseVsBillSchema> & {
    id: string;
    qbId: string;
    type: string;
    date: string | number | Date;
    amount: any;
    currency?: string;
    vendorId?: string;
    qboData?: any;
};

interface NormalizationOutput {
    normalized: TransactionType[];
    unscannable: any[];
}

interface DetectionOutput {
    findings: { bill: TransactionType; purchase: TransactionType }[];
}

export class ExpenseInsteadOfBillPaymentRule implements IRule {
    id: RuleId = 'EXPENSE_INSTEAD_OF_BILL_PAYMENT' as unknown as RuleId;
    name = 'Expense Recorded Instead of Bill Payment';
    severity = 'WARNING' as const;
    description = 'Detects direct expenses recorded for vendors who have open bills of the same amount.';
    category = 'AP_ERRORS' as const;
    version = '1.0.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<any[], NormalizationOutput, DetectionOutput, EnrichedFinding>(
            ctx, this.id, this.name, this.version
        )
            .withData(async (repo, realmId) => {
                return transactionGenerator(repo, {
                    realmId,
                    type: ['Bill', 'Purchase']
                });
            })
            .withNormalization((batch: any[]) => {
                return normalizeTransactionBatch(batch, ExpenseVsBillSchema) as unknown as NormalizationOutput;
            })
            .withDetection((norm: NormalizationOutput) => {
                const validTxns = norm.normalized || [];
                const bills = validTxns.filter((t) => t.type === 'Bill' || t.qboData?.DueDate !== undefined);
                const purchases = validTxns.filter((t) => t.type === 'Purchase' || t.qboData?.PaymentType !== undefined);

                const matches: { bill: TransactionType; purchase: TransactionType }[] = [];
                const windowMs = 7 * 24 * 60 * 60 * 1000;

                for (const bill of bills) {
                    for (const purchase of purchases) {
                        if (!bill.vendorId || bill.vendorId !== purchase.vendorId) continue;

                        const billAmt = bill.amount ? Number(bill.amount) : 0;
                        const purcAmt = purchase.amount ? Number(purchase.amount) : 0;

                        if (Math.abs(billAmt - purcAmt) <= 0.005) {
                            const timeDiff = Math.abs(new Date(bill.date).getTime() - new Date(purchase.date).getTime());
                            if (timeDiff <= windowMs) {
                                matches.push({ bill, purchase });
                            }
                        }
                    }
                }

                return { findings: matches };
            })
            .withEnrichment((detected: DetectionOutput, ctx: RuleContext) => {
                return detected.findings.map((match): EnrichedFinding => {
                    const f = match.purchase;
                    const bill = match.bill;

                    return {
                        id: f.qbId || f.id,
                        label: `Expense ${f.qbId} matches open Bill ${bill.qbId}`,
                        date: new Date(f.date),
                        amount: f.amount as any,
                        currency: f.currency || 'USD',
                        metadata: {
                            billId: bill.qbId,
                            purchaseId: f.qbId,
                            vendorId: f.vendorId,
                            fingerprint: generateFingerprint([this.id, f.qbId, bill.qbId])
                        },
                        entities: [bill, f]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, unscannableErrors: any[]) => {
                return formatReport(reportData, unscannableErrors);
            })
            .execute();
    }
}
