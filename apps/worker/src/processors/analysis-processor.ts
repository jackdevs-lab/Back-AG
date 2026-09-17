import { Job } from 'bullmq';
import { RuleEngine } from '@qb-health/rule-engine';
import { HealthScoreCalculator } from '@qb-health/diagnostics';
import { prisma } from '@qb-health/financial-model';
import { logger, byteSize, chunkByBytes } from '@qb-health/utils';
import { sendAlert, AlertData } from '@qb-health/notifications';
import crypto, { randomUUID } from 'crypto';

export interface AnalysisJobData {
    realmId: string;
    tenantId: string;
    connectionId: string;
    correlationId?: string;
}

const MAX_ROW_BYTES = Number(process.env.MAX_ROW_BYTES ?? 100 * 1024);           // 100 KB
const BATCH_BYTES = Number(process.env.BULK_INSERT_BATCH_BYTES ?? 5 * 1024 * 1024); // 5 MB
const TX_TIMEOUT_MS = Number(process.env.BULK_INSERT_TX_TIMEOUT_MS ?? 60_000);
const MAX_MESSAGE_BYTES = Number(process.env.MAX_MESSAGE_BYTES ?? 16 * 1024);      // 16 KB

type IssueRow = {
    id: string;
    runId: string;
    connectionId: string;
    correlationId: string;
    ruleId: string;
    ruleName: string;
    severity: string;
    message: string;
};

type IssueEntityRow = {
    issueId: string;
    entityId: string;
};

/**
 * Truncates a message to MAX_MESSAGE_BYTES, preserving UTF-8 boundaries.
 * Messages are for humans; anything larger than a few KB is a rule-design
 * problem that belongs in `entities` or `metadata`, not in the message string.
 */
function truncateMessage(msg: unknown): string {
    const s = typeof msg === 'string' ? msg : String(msg ?? '');
    if (byteSize(s) <= MAX_MESSAGE_BYTES) return s;
    const buf = Buffer.from(s, 'utf8').slice(0, MAX_MESSAGE_BYTES - 32);
    return buf.toString('utf8').replace(/\uFFFD+$/, '') + ' … [truncated]';
}

export async function analysisProcessor(job: Job<AnalysisJobData>): Promise<{
    success: boolean;
    diagnosticRunId: string;
    healthScore: number;
    issueCount: number;
}> {
    const { realmId, tenantId, connectionId } = job.data;
    const correlationId = job.data.correlationId || crypto.randomUUID();

    const jobLogger = logger.child({ jobId: job.id, realmId, connectionId, correlationId });

    jobLogger.info('Starting analysis job');

    if (!connectionId) {
        throw new Error(`Analysis job failed: connectionId is required for job ${job.id}`);
    }

    // Phase 4: create the run as RUNNING first, so a failure can update it in place.
    const diagnosticRun = await prisma.diagnosticRun.create({
        data: {
            tenantId,
            connectionId,
            correlationId,
            healthScore: 0,
            status: 'RUNNING',
        },
    });

    try {
        await job.updateProgress(10);

        if (typeof RuleEngine !== 'function') {
            jobLogger.error('RuleEngine is not a constructor. Import resolved to:', { type: typeof RuleEngine });
            throw new Error('RuleEngine initialization failed: Not a constructor');
        }

        const ruleEngine = new RuleEngine(tenantId, realmId, connectionId);
        const { issues, checks } = await ruleEngine.runAllRules();

        await job.updateProgress(60);

        const scoreBreakdown = HealthScoreCalculator.calculate(checks);

        await job.updateProgress(80);

        // ─── Phase 1: split issues into Issue + IssueEntity rows ───────────────
        const issueRows: IssueRow[] = [];
        const entityRows: IssueEntityRow[] = [];
        let truncatedCount = 0;

        for (const issue of issues as any[]) {
            const issueId = randomUUID();

            const originalMessage = typeof issue.message === 'string'
                ? issue.message
                : String(issue.message ?? '');
            const truncated = truncateMessage(originalMessage);
            if (truncated !== originalMessage) {
                truncatedCount++;
                // One-line diagnostic so you can find the fat rule. Remove once
                // the offending rule emits a bounded message.
                jobLogger.warn('Issue message truncated', {
                    ruleId: issue.ruleId,
                    originalBytes: byteSize(originalMessage),
                    truncatedBytes: byteSize(truncated),
                    head: originalMessage.slice(0, 200),
                });
            }

            issueRows.push({
                id: issueId,
                runId: diagnosticRun.id,
                connectionId,
                correlationId,
                ruleId: issue.ruleId,
                ruleName: issue.ruleName,
                severity: issue.severity,
                message: truncated,
            });

            const list = Array.isArray(issue.entities) ? issue.entities : [];
            for (const e of list) {
                // Tolerate both legacy (qbId) and new (entityId) shapes during migration.
                const entityId = String(e?.entityId ?? e?.qbId ?? e?.id ?? '').trim();
                if (entityId) {
                    entityRows.push({ issueId, entityId });
                }
            }
        }

        // Per-row guard on the (now small) issue rows.
        for (const row of issueRows) {
            const size = byteSize(row);
            if (size > MAX_ROW_BYTES) {
                throw new Error(
                    `Issue row exceeds ${MAX_ROW_BYTES} bytes ` +
                    `(ruleId=${row.ruleId}, size=${size}). Normalize or truncate before insert.`
                );
            }
        }

        const issueChunks = chunkByBytes(issueRows, BATCH_BYTES);
        const entityChunks = chunkByBytes(entityRows, BATCH_BYTES);

        jobLogger.info('Prepared bulk insert', {
            issueRows: issueRows.length,
            entityRows: entityRows.length,
            issueChunks: issueChunks.length,
            entityChunks: entityChunks.length,
            truncatedMessages: truncatedCount,
        });

        // Insert issues first, then entities — all in one transaction so a
        // partial failure doesn't leave orphaned issues or entities.
        await prisma.$transaction(async (tx) => {
            for (const chunk of issueChunks) {
                await tx.issue.createMany({ data: chunk, skipDuplicates: true });
            }
            for (const chunk of entityChunks) {
                await tx.issueEntity.createMany({ data: chunk, skipDuplicates: true });
            }
        }, { timeout: TX_TIMEOUT_MS });

        // ─── Checks (small, unchanged pattern) ────────────────────────────────
        const checkRows = (checks as any[]).map((check) => ({
            runId: diagnosticRun.id,
            ruleId: check.ruleId,
            ruleName: check.ruleName,
            category: check.category,
            severity: check.severity,
            status: check.status,
            message: truncateMessage(check.message),
            durationMs: check.durationMs,
        }));

        for (const row of checkRows) {
            const size = byteSize(row);
            if (size > MAX_ROW_BYTES) {
                throw new Error(
                    `Check row exceeds ${MAX_ROW_BYTES} bytes ` +
                    `(ruleId=${row.ruleId}, size=${size}).`
                );
            }
        }

        const checkChunks = chunkByBytes(checkRows, BATCH_BYTES);
        for (const chunk of checkChunks) {
            await prisma.diagnosticCheck.createMany({ data: chunk, skipDuplicates: true });
        }

        await job.updateProgress(90);

        // ─── Metadata ─────────────────────────────────────────────────────────
        const criticalCount = issueRows.filter(i => i.severity === 'CRITICAL').length;
        const warningCount = issueRows.filter(i => i.severity === 'WARNING').length;
        const infoCount = issueRows.filter(i => i.severity === 'INFO').length;
        const entitiesAffected = entityRows.length;   // Phase 1: count from the split rows

        // NOTE: exposure extraction uses the ORIGINAL issue.message (not the
        // truncated one) so truncation cannot silently drop an exposure figure.
        const seenRuleAmounts = new Map<string, Map<string, number>>();
        for (const issue of issues as any[]) {
            const ruleId: string = issue.ruleId;
            const currency: string = issue.metadata?.currency || 'USD';
            const structured: number | undefined = issue.metadata?.exposureAmount;

            if (!seenRuleAmounts.has(ruleId)) {
                seenRuleAmounts.set(ruleId, new Map());
            }
            const currencyMap = seenRuleAmounts.get(ruleId)!;

            if (structured !== undefined && structured > 0) {
                currencyMap.set(currency, (currencyMap.get(currency) ?? 0) + structured);
            } else if (!currencyMap.has(currency) && typeof issue.message === 'string') {
                const match = issue.message.match(
                    /(?:total exposure of|exposure:)\s*\$?([\d,.]+(?:\.\d{2})?)/i
                );
                if (match) {
                    currencyMap.set(currency, (currencyMap.get(currency) ?? 0) + parseFloat(match[1].replace(/,/g, '')));
                }
            }
        }

        let totalExposureValue = 0;
        const currencyBreakdown: Record<string, number> = {};
        for (const currencyMap of seenRuleAmounts.values()) {
            for (const [currency, amount] of currencyMap.entries()) {
                totalExposureValue += amount;
                currencyBreakdown[currency] = (currencyBreakdown[currency] ?? 0) + amount;
            }
        }

        const totalExposureStr = `$${totalExposureValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Phase 4: update the SAME run to COMPLETED with full metadata.
        await prisma.diagnosticRun.update({
            where: { id: diagnosticRun.id },
            data: {
                status: 'COMPLETED',
                healthScore: scoreBreakdown.finalScore,
                metadata: {
                    criticalCount,
                    warningCount,
                    infoCount,
                    entitiesAffected,
                    totalExposure: totalExposureStr,
                    currencyBreakdown,
                    truncatedMessages: truncatedCount,
                },
            },
        });

        // ─── Alerts ───────────────────────────────────────────────────────────
        if (scoreBreakdown.finalScore < 50) {
            const alertData: AlertData = {
                score: scoreBreakdown.finalScore,
                issueCount: issueRows.length,
                criticalCount,
            };

            try {
                await sendAlert(tenantId, alertData);
            } catch (alertError) {
                jobLogger.error('Failed to send alert', alertError as Error);
            }

            jobLogger.warn('Low health score, alert evaluated', {
                score: scoreBreakdown.finalScore,
            });
        }

        await job.updateProgress(100);

        jobLogger.info('Analysis completed', {
            score: scoreBreakdown.finalScore,
            issueCount: issueRows.length,
            entityCount: entityRows.length,
            truncatedMessages: truncatedCount,
        });

        return {
            success: true,
            diagnosticRunId: diagnosticRun.id,
            healthScore: scoreBreakdown.finalScore,
            issueCount: issueRows.length,
        };
    } catch (error) {
        jobLogger.error('Analysis job failed', error as Error);
        const errorMessage = (error as Error).message || 'Analysis job failed unexpectedly';

        // Phase 4: update the same run to FAILED — never create a second one.
        try {
            await prisma.diagnosticRun.update({
                where: { id: diagnosticRun.id },
                data: {
                    status: 'FAILED',
                    errorMessage,
                },
            });
        } catch (dbError) {
            jobLogger.error('Failed to mark diagnostic run as FAILED', dbError as Error);
        }

        throw error;
    }
}