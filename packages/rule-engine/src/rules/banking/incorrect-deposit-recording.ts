//(production ready )

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { DepositRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/incorrect-deposits-recording';

type NormalizedBatch = {
    normalized: (any & { qboData: any })[];
    unscannable: any[];
};

export class IncorrectDepositRecordingRule implements IRule {
    id: RuleId = 'INCORRECT_DEPOSIT_RECORDING' as unknown as RuleId;
    name = 'Incorrect Deposit Recording';
    severity = 'WARNING' as const;
    description = 'Flags customer payments recorded as deposits instead of through the proper payment workflow.';
    category = 'BANK_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<any[], NormalizedBatch, { findings: any[] }, EnrichedFinding>(
            ctx, this.id, this.name, this.version
        )
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - 2);
                return transactionGenerator(repo, { realmId, type: 'Deposit', lookbackDate });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, DepositRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((d) => {
                    const raw: any = d.qboData;
                    const lines: any[] = raw.Line || [];

                    const hasCustomerLine = lines.some((l: any) =>
                        l.DepositLineDetail?.Entity?.type === 'Customer' ||
                        l.DepositLineDetail?.Entity?.value
                    );
                    if (!hasCustomerLine) return false;

                    const hasLinkedPayment = lines.some((l: any) =>
                        Array.isArray(l.LinkedTxn) && l.LinkedTxn.some((lt: any) =>
                            lt.TxnType === 'Payment' || lt.TxnType === 'SalesReceipt'
                        )
                    );

                    return !hasLinkedPayment;
                });
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((d): EnrichedFinding & { fingerprint: string, impactScore: number } => {
                    const raw: any = d.qboData;
                    const amount = raw.TotalAmt || 0;
                    const date = raw.TxnDate || d.date;

                    return {
                        id: d.qbId,
                        label: `Deposit ${d.qbId}`,
                        date: new Date(date),
                        amount: amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        fingerprint: generateFingerprint([this.id, d.qbId]),
                        impactScore: Math.min(100, Math.round(30 * Math.min(2, amount / 1000))),
                        metadata: { qbId: d.qbId },
                        entities: [{ id: d.qbId, type: 'Deposit', amount, date: new Date(date) }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatReport(reportData, ctx, normErrors);
            })
            .execute();
    }
}
