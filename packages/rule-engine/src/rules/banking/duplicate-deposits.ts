// rule.ts

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';
import { transactionGenerator, normalizeTransactionBatch } from '../../core/shared/data-primitives';
import { DepositRawSchema, EnrichedFinding } from '../../core/shared/base-schemas';
import { generateFingerprint } from '../../core/shared/utils';
import { z } from 'zod';

import { Prisma } from '@qb-health/financial-model';

import { formatSummary } from '../../core/report/duplicate-deposits';
import { buildQboDeepLink } from '../../core/shared/deeplink';

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
        const realmId = ctx.realmId;
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
                    const currency = raw.CurrencyRef?.value || 'USD';
                    const date = raw.TxnDate || f.date;

                    // --- CRITICAL FIX: Type-safe amount extraction ---
                    // f.amount is Prisma.Decimal, raw.TotalAmt is a plain number
                    const plainExposureAmount = typeof f.amount?.toNumber === 'function'
                        ? f.amount.toNumber()
                        : Number(raw.TotalAmt || 0);

                    // Wrap for Prisma schema compliance
                    const decimalAmount = new Prisma.Decimal(plainExposureAmount);

                    const clusterLinks = cluster.map(
                        c => buildQboDeepLink('deposit', realmId, c.qbId)
                    );

                    return {
                        id: f.qbId,
                        label: 'Duplicate Deposit',
                        amount: decimalAmount,
                        currency: currency,
                        date: new Date(date),
                        metadata: {
                            clusterIds: cluster.map(c => c.qbId),
                            qbId: f.qbId,
                            impactScore: Math.min(100, Math.round(30 * Math.min(2, plainExposureAmount / 1000))),
                            clusterLinks,

                            // --- NEW: Add these for database save & API ---
                            exposureAmount: plainExposureAmount,
                            currency: currency
                        },
                        entities: cluster.map(c => ({
                            id: c.qbId,
                            type: 'Deposit',
                            amount: plainExposureAmount, // Use plain number for clean JSON
                            date: new Date(c.date) // Use c.date for accuracy per entity
                        })),
                        fingerprint: generateFingerprint([this.id, ...cluster.map(c => c.qbId)]),
                        deepLink: clusterLinks[0]
                    } as EnrichedFinding;
                });
            })
            .withReporting((reportData: any, ctx: RuleContext, normErrors: any[]) => {
                return formatSummary(reportData, normErrors);
            })
            .execute();
    }
}