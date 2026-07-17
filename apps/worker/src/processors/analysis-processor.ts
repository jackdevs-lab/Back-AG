// apps/worker/src/processors/analysis-processor.ts

import { Job } from 'bullmq';
import { RuleEngine } from '@qb-health/rule-engine';
import { HealthScoreCalculator } from '@qb-health/diagnostics';
import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';
import { sendAlert, AlertData } from '@qb-health/notifications';

export interface AnalysisJobData {
    realmId: string;
    tenantId: string;
    connectionId: string;
}

export async function analysisProcessor(job: Job<AnalysisJobData>): Promise<{
    success: boolean;
    diagnosticRunId: string;
    healthScore: number;
    issueCount: number;
}> {
    const { realmId, tenantId, connectionId } = job.data;
    const jobLogger = logger.child({ jobId: job.id, realmId, connectionId }); // Added connectionId to logger context

    jobLogger.info('Starting analysis job');

    try {
        await job.updateProgress(10);

        // Defensive check for RuleEngine constructor
        if (typeof RuleEngine !== 'function') {
            jobLogger.error('RuleEngine is not a constructor. Import resolved to:', { type: typeof RuleEngine });
            throw new Error('RuleEngine initialization failed: Not a constructor');
        }

        const ruleEngine = new RuleEngine(realmId, connectionId);
        const { issues, checks } = await ruleEngine.runAllRules();

        await job.updateProgress(60);

        // Calculate health score
        const scoreBreakdown = HealthScoreCalculator.calculate(checks);

        await job.updateProgress(80);

        // Pre-calculate aggregate metrics for the teaser / metadata payload
        const criticalCount = issues.filter((i: any) => i.severity === 'CRITICAL').length;
        const warningCount = issues.filter((i: any) => i.severity === 'WARNING').length;
        const infoCount = issues.filter((i: any) => i.severity === 'INFO').length;
        const entitiesAffected = issues.reduce((sum: number, i: any) => sum + (i.entities?.length ?? 0), 0);

        // Group by ruleId to ensure we only sum each rule's exposure once.
        // Each issue now carries metadata.exposureAmount (a numeric) set by the
        // PipelineRunner — sum that directly instead of regex-parsing report text.
        // For rules that predate the PipelineRunner (no exposureAmount), we fall
        // back to the regex parser on the message string.
        const seenRuleAmounts = new Map<string, Map<string, number>>(); // ruleId → currency → amount

        for (const issue of issues as any[]) {
            const ruleId: string = issue.ruleId;
            const currency: string = issue.metadata?.currency || 'USD';
            const structured: number | undefined = issue.metadata?.exposureAmount;

            if (!seenRuleAmounts.has(ruleId)) {
                seenRuleAmounts.set(ruleId, new Map());
            }
            const currencyMap = seenRuleAmounts.get(ruleId)!;

            if (structured !== undefined && structured > 0) {
                // Structured path: sum from metadata
                currencyMap.set(currency, (currencyMap.get(currency) ?? 0) + structured);
            } else if (!currencyMap.has(currency) && typeof issue.message === 'string') {
                // Fallback: parse the report text (legacy rules not using PipelineRunner)
                const match = issue.message.match(
                    /(?:total exposure of|exposure:)\s*\$?([\d,.]+(?:\.\d{2})?)/i
                );
                if (match) {
                    currencyMap.set(currency, (currencyMap.get(currency) ?? 0) + parseFloat(match[1].replace(/,/g, '')));
                }
            }
        }

        // Flatten to a single USD-equivalent total for the metadata teaser.
        // Multi-currency sums are stored per-currency in the breakdown.
        let totalExposureValue = 0;
        const currencyBreakdown: Record<string, number> = {};
        for (const currencyMap of seenRuleAmounts.values()) {
            for (const [currency, amount] of currencyMap.entries()) {
                totalExposureValue += amount; // approximation for score; use breakdown for display
                currencyBreakdown[currency] = (currencyBreakdown[currency] ?? 0) + amount;
            }
        }

        const totalExposureStr = `$${totalExposureValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // Save diagnostic run
        const diagnosticRun = await prisma.diagnosticRun.create({
            data: {
                tenantId,
                connectionId,
                healthScore: scoreBreakdown.finalScore,
                status: 'COMPLETED',
                metadata: {
                    criticalCount,
                    warningCount,
                    infoCount,
                    entitiesAffected,
                    totalExposure: totalExposureStr,
                    // Structured per-currency breakdown — avoids re-parsing totalExposureStr downstream
                    currencyBreakdown
                },
                issues: {
                    create: issues.map((issue: any) => ({
                        connectionId,
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

        // Send alerts if score is low
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

        // **** ADDITION: Update connection status to IDLE on SUCCESS ****
        await prisma.qbConnection.update({
            where: { id: connectionId },
            data: { syncStatus: 'IDLE', lastSyncMessage: null } // Clear any previous messages on success
        });
        jobLogger.info('Connection status updated to IDLE after successful analysis.');

        return {
            success: true,
            diagnosticRunId: diagnosticRun.id,
            healthScore: scoreBreakdown.finalScore,
            issueCount: issues.length
        };
    } catch (error) {
        jobLogger.error('Analysis job failed', error as Error);

        // **** ADDITION: Update connection status to ERROR on FAILURE ****
        const errorMessage = (error as Error).message || 'Analysis job failed unexpectedly';
        try {
            await prisma.qbConnection.update({
                where: { id: connectionId },
                data: { syncStatus: 'ERROR', lastSyncMessage: errorMessage }
            });
            jobLogger.info('Connection status updated to ERROR after failed analysis.');
        } catch (statusUpdateError) {
            jobLogger.error('Failed to update connection status to ERROR after analysis failure', statusUpdateError as Error);
            // Depending on requirements, you might still want to throw the original error
            // or the status update error, or log both and proceed.
            // For now, throwing the original error seems appropriate.
        }


        try {
            await prisma.diagnosticRun.create({
                data: {
                    tenantId,
                    connectionId,
                    healthScore: 0, // Or however you represent a failed run's score
                    status: 'FAILED',
                    errorMessage: errorMessage
                }
            });
        } catch (dbError) {
            jobLogger.error('Failed to log failed diagnostic run to DB', dbError as Error);
        }

        throw error; // Re-throw the original error
    }
}