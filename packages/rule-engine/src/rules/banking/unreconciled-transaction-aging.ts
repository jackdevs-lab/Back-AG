import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { safeDecimal, safeDate, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/unreconciled-transaction-aging';
import Decimal from 'decimal.js';

const TxnRawSchema = z.object({
    TotalAmt: safeDecimal.optional(),
    TxnDate: safeDate.optional(),
    CurrencyRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    AccountRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    DepositToAccountRef: z.object({ value: z.string().optional() }).passthrough().optional(),
    ReconcileStatus: z.string().optional(),
    ClearDate: z.string().optional(),
    TxnType: z.string().optional(),
    type: z.string().optional()
}).passthrough();

type RawTransaction = {
    id: string;
    qbId: string;
    date: Date;
    amount: Decimal;
    rawData: any;
    type?: string;
    vendorId?: string;
    customerId?: string;
    syncToken?: string;
};

type NormalizedTxn = RawTransaction & { qboData: z.infer<typeof TxnRawSchema> };

type NormalizedBatch = {
    normalized: NormalizedTxn[];
    unscannable: any[];
};

type DetectionResult = {
    findings: NormalizedTxn[];
};

type FinalEnrichedFinding = EnrichedFinding & {
    fingerprint: string;
    impactScore: number;
    type?: string;
};

const AGING_THRESHOLD_DAYS = 60;
const UNRECONCILED_TYPES = ['Check', 'Deposit', 'Transfer', 'JournalEntry'];

export class UnreconciledTransactionAgingRule implements IRule {
    id: RuleId = 'UNRECONCILED_TRANSACTION_AGING' as unknown as RuleId;
    name = 'Unreconciled Transaction Aging';
    severity = 'WARNING' as const;
    description = 'Detects bank transactions that have remained unreconciled for more than 60 days.';
    category = 'BANK_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            RawTransaction[],
            NormalizedBatch,
            DetectionResult,
            FinalEnrichedFinding
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - 2);

                return transactionGenerator(repo, {
                    realmId,
                    type: UNRECONCILED_TYPES,
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: RawTransaction[]) => normalizeTransactionBatch(batch, TxnRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                const thresholdDate = new Date();
                thresholdDate.setDate(thresholdDate.getDate() - AGING_THRESHOLD_DAYS);

                const findings = norm.normalized.filter((txn) => {
                    const raw = txn.qboData;
                    if (raw.ClearDate || raw.ReconcileStatus === 'R') return false;
                    const txnDate = raw.TxnDate || txn.date;
                    if (!txnDate) return false;

                    return new Date(txnDate) < thresholdDate;
                });

                return { findings };
            })
            .withEnrichment((detected: DetectionResult) => {
                return detected.findings.map((f): FinalEnrichedFinding => {
                    const raw = f.qboData;
                    const amount = new Decimal(raw.TotalAmt || 0);
                    const date = raw.TxnDate || f.date;
                    const parsedDate = new Date(date);
                    const daysOld = Math.floor((Date.now() - parsedDate.getTime()) / 86400000);
                    const txnType = f.type || raw.TxnType || raw.type || 'Transaction';

                    return {
                        id: f.qbId,
                        type: txnType,
                        label: `${txnType} ${f.qbId}`,
                        date: parsedDate,
                        amount: amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        fingerprint: generateFingerprint([this.id, f.qbId]),
                        impactScore: Math.min(100, Math.round(20 + Math.min(80, daysOld / 5))),
                        metadata: {
                            qbId: f.qbId,
                            daysOld,
                            txnType: txnType
                        },
                        entities: [{ id: f.qbId, type: txnType, amount, date: parsedDate }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatReport(reportData, ctx, normErrors);
            })
            .execute();
    }
}