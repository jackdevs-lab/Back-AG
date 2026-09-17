import { Job } from 'bullmq';
import { RuleEngine } from '@qb-health/rule-engine';
import { HealthScoreCalculator } from '@qb-health/diagnostics';
import { prisma } from '@qb-health/financial-model';
import { logger, byteSize, chunkByBytes } from '@qb-health/utils';
import { sendAlert, AlertData } from '@qb-health/notifications';
import crypto from 'crypto';

export interface AnalysisJobData {
    realmId: string;
    tenantId: string;
    connectionId: string;
    correlationId?: string;
}

const MAX_ROW_BYTES = Number(process.env.MAX_ROW_BYTES ?? 100 * 1024);          // 100 KB
const BATCH_BYTES = Number(process.env.BULK_INSERT_BATCH_BYTES ?? 5 * 1024 * 1024); // 5 MB

export async function analysisProcessor(job: Job<AnalysisJobData>): Promise<{
    success: boolean;
    diagnosticRunId: string;
    healthScore: number;
    issueCount: number;
}> {
    const { realmId, tenantId, connectionId } = job.data;
    const correlationId = job.data.correlationId || crypto.randomUUID();

    // Bind correlationId into the base logger
    const jobLogger = logger.child({ jobId: job.id, realmId, connectionId, correlationId });

    jobLogger.info('Starting analysis job');

    if (!connectionId) {
        throw new Error(`Analysis job failed: connectionId is required for job ${job.id}`);
    }

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

        const criticalCount = issues.filter((i: any) => i.severity === 'CRITICAL').length;
        const warningCount = issues.filter((i: any) => i.severity === 'WARNING').length;
        const infoCount = issues.filter((i: any) => i.severity === 'INFO').length;
        const entitiesAffected = issues.reduce((sum: number, i: any) => sum + (i.entities?.length ?? 0), 0);

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

        // Create the parent DiagnosticRun FIRST (without nested creates)
        const diagnosticRun = await prisma.diagnosticRun.create({
            data: {
                tenantId,
                connectionId,
                correlationId,
                healthScore: scoreBreakdown.finalScore,
                status: 'COMPLETED',
                metadata: {
                    criticalCount,
                    warningCount,
                    infoCount,
                    entitiesAffected,
                    totalExposure: totalExposureStr,
                    currencyBreakdown
                }
            }
        });

        // Map once, with the per-row guard.
        const issueRows = (issues as any[]).map((issue) => {
            const row = {
                runId: diagnosticRun.id,
                connectionId,
                correlationId,
                ruleId: issue.ruleId,
                ruleName: issue.ruleName,
                severity: issue.severity,
                message: issue.message,
                entities: issue.entities || [],
            };
            const size = byteSize(row);
            if (size > MAX_ROW_BYTES) {
                throw new Error(
                    `Issue row exceeds ${MAX_ROW_BYTES} bytes ` +
                    `(ruleId=${row.ruleId}, size=${size}). Normalize or truncate before insert.`
                );
            }
            return row;
        });

        // Chunk by serialized bytes, not by count.
        const issueChunks = chunkByBytes(issueRows, BATCH_BYTES);
        for (const chunk of issueChunks) {
            await prisma.issue.createMany({
                data: chunk,
                skipDuplicates: true,
            });
        }

        // Map checks first, with the per-row guard.
        const checkRows = (checks as any[]).map((check) => {
            const row = {
                runId: diagnosticRun.id,
                ruleId: check.ruleId,
                ruleName: check.ruleName,
                category: check.category,
                severity: check.severity,
                status: check.status,
                message: check.message,
                durationMs: check.durationMs,
            };
            const size = byteSize(row);
            if (size > MAX_ROW_BYTES) {
                throw new Error(
                    `Check row exceeds ${MAX_ROW_BYTES} bytes ` +
                    `(ruleId=${row.ruleId}, size=${size}).`
                );
            }
            return row;
        });

        const checkChunks = chunkByBytes(checkRows, BATCH_BYTES);
        for (const chunk of checkChunks) {
            await prisma.diagnosticCheck.createMany({
                data: chunk,
                skipDuplicates: true,
            });
        }

        await job.updateProgress(90);

        if (scoreBreakdown.finalScore < 50) {
            const alertData: AlertData = {
                score: scoreBreakdown.finalScore,
                issueCount: issues.length,
                criticalCount: issues.filter(i => i.severity === 'CRITICAL').length
            };

            try {
                await sendAlert(tenantId, alertData);
            } catch (alertError) {
                jobLogger.error('Failed to send alert', alertError as Error);
            }

            jobLogger.warn('Low health score, alert evaluated', {
                score: scoreBreakdown.finalScore
            });
        }

        await job.updateProgress(100);

        jobLogger.info('Analysis completed', {
            score: scoreBreakdown.finalScore,
            issueCount: issues.length
        });

        return {
            success: true,
            diagnosticRunId: diagnosticRun.id,
            healthScore: scoreBreakdown.finalScore,
            issueCount: issues.length
        };
    } catch (error) {
        jobLogger.error('Analysis job failed', error as Error);
        const errorMessage = (error as Error).message || 'Analysis job failed unexpectedly';

        try {
            await prisma.diagnosticRun.create({
                data: {
                    tenantId,
                    connectionId,
                    correlationId,
                    healthScore: 0,
                    status: 'FAILED',
                    errorMessage: errorMessage
                }
            });
        } catch (dbError) {
            jobLogger.error('Failed to log failed diagnostic run to DB', dbError as Error);
        }

        throw error;
    }
}