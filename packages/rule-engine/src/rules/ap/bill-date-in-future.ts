//(version production)
import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { formatReport } from '../../core/report/bill-date-in-future';
import { normalizeTransactionBatch, transactionGenerator } from '../../core/shared/data-primitives';
import { BillRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';

export class BillDateInFutureRule implements IRule {
    id: RuleId = 'BILL_DATE_IN_FUTURE' as unknown as RuleId;
    name = 'Bill Date In Future';
    severity = 'WARNING' as const;
    description = 'Detects bills with dates later than the current date.';
    category = 'AP_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<any[], { normalized: z.infer<typeof BillRawSchema>[]; unscannable: any[] }, { findings: any[] }, EnrichedFinding>(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => transactionGenerator(repo, { realmId, type: 'Bill' }))

            .withNormalization((batch) => normalizeTransactionBatch(batch, BillRawSchema))

            .withDetection((norm) => {
                return {
                    findings: norm.normalized.filter((b: any) => b.date > new Date())
                };
            })

            .withEnrichment((detected): EnrichedFinding[] => {
                return detected.findings.map((f: any) => ({
                    id: f.qbId,
                    label: `Bill ${f.qbId}`,
                    date: f.date,
                    amount: f.amount,
                    currency: f.qboData?.CurrencyRef?.name || 'USD',
                    fingerprint: generateFingerprint([this.id, f.qbId]),
                }));
            })

            .withReporting((reportData, ctx, normErrors) => {
                return formatReport(ctx.realmId,
                    Array.isArray(reportData) ? reportData : reportData.findingsForDisplay,
                    normErrors,
                    reportData
                );
            })
            .execute();
    }
}
