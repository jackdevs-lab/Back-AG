//(production ready)
import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { PaymentRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/orphaned-payments';

type NormalizedBatch = {
    normalized: (any & { qboData: z.infer<typeof PaymentRawSchema> })[];
    unscannable: any[];
};

export class OrphanedPaymentRule implements IRule {
    id: RuleId = 'ORPHANED_PAYMENT' as unknown as RuleId;
    name = 'Orphaned Customer Payment';
    severity = 'WARNING' as const;
    description = 'Detects customer payments that are not linked to any invoices.';
    category = 'AR_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            any[],
            NormalizedBatch,
            { findings: any[] },
            EnrichedFinding
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setDate(lookbackDate.getDate() - 730);

                return transactionGenerator(repo, {
                    realmId,
                    type: 'Payment',
                    lookbackDate,
                    hasStatusColumn: false
                });
            })
            .withNormalization((batch: any[]) => {
                return normalizeTransactionBatch(batch, PaymentRawSchema);
            })
            .withDetection((norm: NormalizedBatch) => {
                const findings = norm.normalized.filter((pay) => {
                    const raw: any = pay.qboData;

                    // Gate 1 (primary): QBO explicitly marks the unapplied portion.
                    // UnappliedAmt > 0 is the authoritative signal � check it first before
                    // inspecting Line entries, because QBO attaches non-empty LinkedTxn
                    // entries to unapplied payments (pointing to AR clearing accounts),
                    // which would otherwise cause a false negative.
                    const unappliedAmt = Number(raw.UnappliedAmt ?? 0);
                    if (unappliedAmt > 0) return true;

                    // Gate 2 (fallback): No Line entries at all ? orphaned.
                    if (!Array.isArray(raw.Line) || raw.Line.length === 0) return true;

                    // Gate 3: Only treat the payment as applied if at least one Line is
                    // explicitly linked to an Invoice. Linking to any other TxnType
                    // (e.g. "Advance", "CreditMemo") does NOT mean it was applied.
                    const hasInvoiceLink = raw.Line.some((l: any) =>
                        Array.isArray(l.LinkedTxn) &&
                        l.LinkedTxn.some((lt: any) => lt.TxnType === 'Invoice')
                    );

                    return !hasInvoiceLink;
                });

                return { findings };
            })
            .withEnrichment((detected: { findings: any[] }): EnrichedFinding[] => {
                return detected.findings.map((f) => {
                    const raw = f.qboData;
                    const amount = raw.TotalAmt || 0;
                    const date = raw.TxnDate || f.date;
                    const fingerprint = generateFingerprint([this.id, f.qbId]);
                    const impactScore = Math.min(100, Math.round(30 * Math.min(2, amount / 1000)));

                    return {
                        id: f.qbId,
                        label: `Orphaned Payment ${f.qbId}`,
                        date: new Date(date),
                        amount: amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        metadata: {
                            customerId: raw.CustomerRef?.value,
                            qbId: f.qbId,
                            fingerprint,
                            impactScore
                        },
                        entities: [{
                            id: f.qbId,
                            type: 'Payment',
                            amount,
                            date: new Date(date)
                        }]
                    };
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatReport(reportData, ctx, normErrors);
            })
            .execute();
    }
}
