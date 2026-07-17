import { Prisma } from '@qb-health/financial-model';
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';

// Layered dependencies
import { fetchJournalEntries, fetchRuleConfig, fetchSyncLogs } from '../../core/data/unbalanced-ledger';
import { normalizeJournalEntry } from '../../core/normalize/unbalanced-ledger';
import { isUnbalanced } from '../../core/detect/unbalanced-ledger';
import { generateFingerprint, calculateImpactScore } from '../../core/enrich/unbalanced-ledger';
import { formatReport } from '../../core/report/unbalanced-ledger';

/**
 * Rule: Unbalanced Journal Entries
 * 
 * Detects journal entries where total debits do not equal total credits.
 * Delegates all logic to hyper-modular layers.
 */
export class UnbalancedLedgerRule implements IRule {
    id: RuleId = 'UNBALANCED_LEDGER' as unknown as RuleId;
    name = 'Unbalanced Journal Entries';
    severity = 'CRITICAL' as const;
    description = 'Detects journal entries where debits do not equal credits';
    category = 'BALANCE' as const;
    version = '3.0.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const config = await fetchRuleConfig(repo, realmId, this.id);
                const syncLogs = await fetchSyncLogs(repo, { realmId, entityTypes: ['JournalEntry'] });
                const journalEntries = await fetchJournalEntries(repo, realmId);
                return { config, syncLogs, journalEntries };
            })
            .withNormalization((raw: any) => {
                const normalized = raw.journalEntries.map((je: any) => normalizeJournalEntry(je));
                return { journalEntries: normalized, config: raw.config };
            })
            .withDetection((norm: any) => {
                const tolerance = new Prisma.Decimal((norm.config?.json as any)?.tolerance ?? '0.01');
                return norm.journalEntries.filter((je: any) => isUnbalanced(je.variance, tolerance));
            })
            .withEnrichment((findings: any) => {
                return findings.map((f: any) => ({
                    fingerprint: generateFingerprint(f.qbId, f.variance.toNumber()),
                    impactScore: calculateImpactScore(f.variance.toNumber()),
                    entities: [{
                        id: f.qbId,
                        debitTotal: f.debitTotal.toNumber(),
                        creditTotal: f.creditTotal.toNumber(),
                        variance: f.variance.toNumber()
                    }],
                    raw: f
                }));
            })
            .withReporting((enriched: any, ctx: RuleContext) => {
                const findings = enriched.map((e: any) => e.raw);
                return formatReport(ctx.realmId, findings);
            })
            .execute();
    }
}
