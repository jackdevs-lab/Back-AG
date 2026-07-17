
import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';

// Layered dependencies
import { fetchJournalEntries, fetchRuleConfig, fetchSyncLogs } from '../../core/data/je-without-name';
import { normalizeJournalEntry } from '../../core/normalize/je-without-name';
import { hasMissingName } from '../../core/detect/je-without-name';
import { generateFingerprint, calculateImpactScore } from '../../core/enrich/je-without-name';
import { formatReport } from '../../core/report/je-without-name';

/**
 * Rule: Journal Entry Without Name
 * 
 * Detects journal entries where lines are missing a required Customer, Vendor, or Employee name.
 * Delegates all logic to hyper-modular layers.
 */
export class JEWithoutNameRule implements IRule {
    id: RuleId = 'JE_WITHOUT_NAME' as unknown as RuleId;
    name = 'Journal Entry Without Name';
    severity = 'INFO' as const;
    description = 'Detects journal entries where lines are missing a required Customer, Vendor, or Employee name.';
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
                return norm.journalEntries.filter((je: any) => hasMissingName(je.linesMissingName));
            })
            .withEnrichment((findings: any) => {
                return findings.map((f: any) => ({
                    fingerprint: generateFingerprint(f.qbId, f.linesMissingName.length),
                    impactScore: calculateImpactScore(f.linesMissingName.length),
                    entities: [{
                        id: f.qbId,
                        linesCount: f.linesMissingName.length,
                        missingLines: f.linesMissingName
                    }],
                    raw: f
                }));
            })
            .withReporting((enriched: any, ctx: RuleContext) => {
                const findings = enriched.map((e: any) => ({
                    qbId: e.raw.qbId,
                    date: e.raw.date,
                    missingLines: e.raw.linesMissingName
                }));
                return formatReport(ctx.realmId, findings);
            })
            .execute();
    }
}
