//(production ready)

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { DepositRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { z } from 'zod';

import { Prisma } from '@qb-health/financial-model';

import { formatReport } from '../../core/report/duplicate-deposits';

type DepositRaw = z.infer<typeof DepositRawSchema>;

interface NormalizedDeposit {
    id: string;
    qbId: string;
    date: Date;
    amount: Prisma.Decimal;
    rawData: any;
    qboData: DepositRaw;
}

interface NormalizedBatch {
    normalized: NormalizedDeposit[];
    unscannable: any[];
}

export class DuplicateDepositsRule implements IRule {
    id: RuleId = 'DUPLICATE_DEPOSIT' as unknown as RuleId;
    name = 'Duplicate Deposits';
    severity = 'WARNING' as const;
    description = 'Detects duplicate Deposit transactions using multi-dimensional matching.';
    category = 'BANK_ERRORS' as const;
    version = '3.1.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            any[],
            NormalizedBatch,
            { findings: NormalizedDeposit[][] },
            EnrichedFinding
        >(
            ctx, this.id, this.name, this.version
        )
            .withData(async (repo, realmId) => {
                const lookbackDate = new Date();
                lookbackDate.setFullYear(lookbackDate.getFullYear() - 2);
                return transactionGenerator(repo, { realmId, type: 'Deposit', lookbackDate });
            })
            .withNormalization((batch: any[]) => normalizeTransactionBatch(batch, DepositRawSchema) as unknown as NormalizedBatch)
            .withDetection((norm: NormalizedBatch) => {
                const groups = new Map<string, NormalizedDeposit[]>();

                for (const d of norm.normalized) {
                    const raw = d.qboData;
                    const dateKey = raw.TxnDate ? raw.TxnDate.split('T')[0] : 'NoDate';
                    const amountKey = raw.TotalAmt ? raw.TotalAmt.toFixed(2) : 'NoAmount';
                    const accountKey = raw.DepositToAccountRef?.value || 'NoAccount';
                    const currencyKey = raw.CurrencyRef?.value || 'USD';

                    if (amountKey === 'NoAmount') continue;

                    const key = `${dateKey}|${amountKey}|${accountKey}|${currencyKey}`;
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(d);
                }

                const findings = Array.from(groups.values()).filter(g => g.length > 1);
                return { findings };
            })
            .withEnrichment((detected: { findings: NormalizedDeposit[][] }) => {
                return detected.findings.map((cluster) => {
                    const f = cluster[0];
                    const raw = f.qboData;

                    const amount = new Prisma.Decimal(raw.TotalAmt || 0);
                    const date = raw.TxnDate || f.date;

                    return {
                        id: f.qbId,
                        label: 'Duplicate Deposit',
                        amount,
                        currency: raw.CurrencyRef?.value || 'USD',
                        date: new Date(date),
                        metadata: {
                            clusterIds: cluster.map(c => c.qbId),
                            qbId: f.qbId,
                            impactScore: Math.min(100, Math.round(30 * Math.min(2, amount.toNumber() / 1000)))
                        },
                        entities: cluster.map(c => ({
                            id: c.qbId,
                            type: 'Deposit',
                            amount,
                            date: new Date(date)
                        })),
                        fingerprint: generateFingerprint([this.id, ...cluster.map(c => c.qbId)])
                    } as EnrichedFinding;
                });
            })
            .withReporting(async (reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatReport(reportData, ctx, normErrors);
            })
            .execute();
    }
}
