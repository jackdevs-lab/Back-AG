import { Job } from 'bullmq';
import { RuleEngine } from '@qb-health/rule-engine';
import { HealthScoreCalculator } from '@qb-health/diagnostics';
import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';
import { sendAlert, AlertData } from '@qb-health/notifications';
import crypto from 'crypto';

export interface AnalysisJobData {
    realmId: string;
    tenantId: string;
    connectionId: string;
    correlationId?: string;
}

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

        // Persist correlationId when writing DiagnosticRun and Issue rows
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
                },
                issues: {
                    create: issues.map((issue: any) => ({
                        connectionId,
                        correlationId, // Cascaded Traceability
                        ruleId: issue.ruleId,
                        ruleName: issue.ruleName,
                        severity: issue.severity,
                        message: issue.message,
                        entities: issue.entities || []
                    }))
                },
                checks: {
                    create: checks.map((check: any) => ({
                        ruleId: check.ruleId,
                        ruleName: check.ruleName,
                        category: check.category,
                        severity: check.severity,
                        status: check.status,
                        message: check.message,
                        durationMs: check.durationMs
                    }))
                }
            }
        });

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
                    correlationId, // Ensure trace ID is retained on failure
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