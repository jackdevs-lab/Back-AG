//(production ready 5/5/2026)

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner, DataResult } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { PaymentRawSchema } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/unapplied-payments';
import { z } from 'zod';

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof PaymentRawSchema> })[];
    unscannable: any[];
};

export class UnappliedPaymentsRule implements IRule {
    id: RuleId = 'UNAPPLIED_PAYMENT' as unknown as RuleId;
    name = 'Unapplied Customer Payments';
    severity = 'WARNING' as const;
    description = 'Detects payments that have not been applied to any invoice.';
    category = 'AR_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<DataResult<any[]>, NormalizedBatch, { findings: any[] }, any>(
            ctx, this.id, this.name, this.version
        )
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - 2);

                return transactionGenerator(repo, {
                    realmId,
                    type: 'Payment',
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, PaymentRawSchema))
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((pay) => {
                    const raw: any = pay.qboData;
                    const lines: any[] = raw.Line || [];

                    // Gate 1 (primary): UnappliedAmt > 0 is the authoritative QBO signal.
                    // Must check before inspecting Line/LinkedTxn because QBO can attach
                    // non-Invoice LinkedTxn entries to unapplied payments.
                    const unappliedAmt = Number(raw.UnappliedAmt ?? 0);
                    if (unappliedAmt > 0) return true;

                    // Gate 2 (fallback): No Line entries ? unapplied.
                    if (lines.length === 0) return true;

                    // Gate 3: Only cleared if at least one Line is linked to an Invoice.
                    const hasInvoiceLink = lines.some((l: any) =>
                        Array.isArray(l.LinkedTxn) && l.LinkedTxn.some((lt: any) => lt.TxnType === 'Invoice')
                    );

                    return !hasInvoiceLink;
                });
                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }) => {
                return detected.findings.map((pay) => {
                    const raw: any = pay.qboData;
                    const amount = raw.TotalAmt || 0;
                    const date = raw.TxnDate || pay.date;

                    return {
                        id: pay.qbId,
                        label: `Unapplied Payment: ${pay.qbId}`,
                        date: new Date(date),
                        amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        fingerprint: generateFingerprint([this.id, pay.qbId]),
                        impactScore: Math.min(100, Math.round(30 * Math.min(2, amount / 1000))),
                        metadata: {
                            qbId: pay.qbId,
                            customerId: raw.CustomerRef?.value
                        },
                        entities: [{ id: pay.qbId, type: 'Payment', amount, date: new Date(date) }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatReport(reportData, ctx, normErrors);
            })
            .execute();
    }
}
