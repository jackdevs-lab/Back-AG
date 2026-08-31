// apps/api/src/routes/diagnostics.ts
import { Router, Request, Response } from 'express';
import { prisma } from '@qb-health/financial-model';
import { HealthScoreCalculator } from '@qb-health/diagnostics';
import { AppError } from '../middleware/error-handler';
import { AuthRequest } from '../middleware/auth';
import { sseEventEmitter } from '../queue';
import { BillingGuardService } from './services/billing-guard.service';

const billingGuard = new BillingGuardService();
const router: Router = Router();

// ✅ UNGATED TEASER OVERVIEW ENDPOINT
router.get('/overview/:connectionId', async (req: AuthRequest, res: Response, next) => {
    try {
        const { connectionId } = req.params;
        const { tenantId } = req;

        const connection = await prisma.qbConnection.findUnique({
            where: { id: connectionId }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        const latestRun = await prisma.diagnosticRun.findFirst({
            where: {
                tenantId,
                connectionId
            },
            orderBy: { runAt: 'desc' }
        });

        if (!latestRun) {
            return res.json({
                success: true,
                data: null,
                message: 'No diagnostic runs found'
            });
        }

        const metadata = (latestRun.metadata as any) || {};

        let criticalCount = metadata.criticalCount;
        let warningCount = metadata.warningCount;
        let infoCount = metadata.infoCount;
        let totalEntities = metadata.entitiesAffected;
        let totalExposureStr = metadata.totalExposure;

        const isMetadataComplete =
            criticalCount !== undefined &&
            warningCount !== undefined &&
            infoCount !== undefined &&
            totalEntities !== undefined &&
            totalExposureStr !== undefined;

        if (!isMetadataComplete) {
            const allIssuesSummary = await prisma.issue.findMany({
                where: { runId: latestRun.id },
                select: { ruleId: true, severity: true, entities: true, message: true }
            });

            criticalCount = allIssuesSummary.filter(i => i.severity === 'CRITICAL').length;
            warningCount = allIssuesSummary.filter(i => i.severity === 'WARNING').length;
            infoCount = allIssuesSummary.filter(i => i.severity === 'INFO').length;
            totalEntities = allIssuesSummary.reduce((sum, i) => sum + ((i.entities as any[])?.length ?? 0), 0);

            const uniqueRuleMessages = Array.from(
                new Map(allIssuesSummary.map(issue => [issue.ruleId, issue.message])).values()
            );

            const totalExposureValue = uniqueRuleMessages.reduce((sum, message) => {
                const match = message.match(/(?:total exposure of|exposure:)\s*\$?([\d,.]+(?:\.\d{2})?)/i);
                if (match) {
                    return sum + parseFloat(match[1].replace(/,/g, ''));
                }
                return sum;
            }, 0);

            totalExposureStr = `$${totalExposureValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }

        const totalIssues = (criticalCount || 0) + (warningCount || 0) + (infoCount || 0);

        // Returns ONLY aggregate metrics — no granular record-level details or issues array
        return res.json({
            success: true,
            data: {
                runId: latestRun.id,
                runAt: latestRun.runAt,
                healthScore: latestRun.healthScore,
                totalIssues,
                breakdown: {
                    criticalCount: criticalCount || 0,
                    warningCount: warningCount || 0,
                    infoCount: infoCount || 0,
                },
                totalEntitiesAffected: totalEntities || 0,
                totalExposure: totalExposureStr || '$0.00'
            }
        });
    } catch (error) {
        return next(error);
    }
});
router.get('/latest/:connectionId', async (req: AuthRequest, res: Response, next) => {
    try {
        const { connectionId } = req.params;
        const { tenantId } = req;

        const connection = await prisma.qbConnection.findUnique({
            where: { id: connectionId }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        // ✅ 1. HARD PAYWALL CHECK
        const isActive = await billingGuard.isSubscriptionActive(connectionId);

        if (!isActive) {
            // Fetch header only (no heavy includes) for the teaser numbers
            const teaserRun = await prisma.diagnosticRun.findFirst({
                where: { tenantId, connectionId },
                orderBy: { runAt: 'desc' },
                select: { id: true, runAt: true, healthScore: true, metadata: true }
            });

            let criticalCount = 0, warningCount = 0, infoCount = 0, totalEntities = 0;
            let totalExposureStr = '$0.00';

            if (teaserRun) {
                const metadata = (teaserRun.metadata as any) || {};
                criticalCount = metadata.criticalCount ?? 0;
                warningCount = metadata.warningCount ?? 0;
                infoCount = metadata.infoCount ?? 0;
                totalEntities = metadata.entitiesAffected ?? 0;
                totalExposureStr = metadata.totalExposure ?? '$0.00';

                // Fallback if metadata incomplete
                if (metadata.criticalCount === undefined) {
                    const allIssues = await prisma.issue.findMany({
                        where: { runId: teaserRun.id },
                        select: { severity: true, entities: true }
                    });
                    criticalCount = allIssues.filter(i => i.severity === 'CRITICAL').length;
                    warningCount = allIssues.filter(i => i.severity === 'WARNING').length;
                    infoCount = allIssues.filter(i => i.severity === 'INFO').length;
                    totalEntities = allIssues.reduce((s, i) => s + ((i.entities as any[])?.length ?? 0), 0);
                }
            }

            const totalIssues = criticalCount + warningCount + infoCount;
            const runAtIso = teaserRun?.runAt ? new Date(teaserRun.runAt).toISOString() : null;

            return res.json({
                success: true,
                data: {
                    locked: true,
                    message: 'An active subscription is required to view the full diagnostic report.',
                    // ✅ Shape-safe fields the frontend expects (never omit dates!)
                    id: teaserRun?.id ?? null,
                    runId: teaserRun?.id ?? null,
                    runAt: runAtIso,
                    lastRunAt: runAtIso,
                    healthScore: teaserRun?.healthScore ?? 0,
                    scoreLabel: 'Locked',
                    scoreColor: '#94A3B8',
                    criticalCount,
                    warningCount,
                    infoCount,
                    issueCount: totalIssues,
                    totalIssues,
                    totalEntities,
                    affectedEntitiesCount: totalEntities,
                    totalExposure: totalExposureStr,
                    summary: {
                        totalIssues,
                        criticalCount,
                        warningCount,
                        infoCount,
                        affectedEntitiesCount: totalEntities,
                        totalEntities,
                        totalExposure: totalExposureStr
                    },
                    checks: [],   // Granular data stays hidden
                    issues: []    // Granular data stays hidden
                }
            });
        }

        // ... your existing UNLOCKED full-report logic below stays unchanged ...

        // 2. Fetch the data (Only runs if they paid)
        const latestRun = await prisma.diagnosticRun.findFirst({
            where: { tenantId, connectionId },
            orderBy: { runAt: 'desc' },
            include: { issues: { orderBy: { severity: 'desc' }, take: 50 }, checks: true }
        });

        if (!latestRun) {
            return res.json({ success: true, data: null, message: 'No diagnostic runs found' });
        }

        // 2. Prepare the summary/teaser metadata
        const metadata = (latestRun.metadata as any) || {};
        let criticalCount = metadata.criticalCount;
        let warningCount = metadata.warningCount;
        let infoCount = metadata.infoCount;
        let totalEntities = metadata.entitiesAffected;
        let totalExposureStr = metadata.totalExposure;

        const isMetadataComplete =
            criticalCount !== undefined &&
            warningCount !== undefined &&
            infoCount !== undefined &&
            totalEntities !== undefined &&
            totalExposureStr !== undefined;

        let issueCount = isMetadataComplete
            ? (criticalCount + warningCount + infoCount)
            : 0;

        // Fallback logic if metadata is incomplete
        if (!isMetadataComplete) {
            const allIssuesSummary = await prisma.issue.findMany({
                where: { runId: latestRun.id },
                select: { ruleId: true, severity: true, entities: true, message: true }
            });

            criticalCount = allIssuesSummary.filter(i => i.severity === 'CRITICAL').length;
            warningCount = allIssuesSummary.filter(i => i.severity === 'WARNING').length;
            infoCount = allIssuesSummary.filter(i => i.severity === 'INFO').length;
            totalEntities = allIssuesSummary.reduce((sum, i) => sum + ((i.entities as any[])?.length ?? 0), 0);
            issueCount = allIssuesSummary.length;

            const uniqueRuleMessages = Array.from(
                new Map(allIssuesSummary.map(issue => [issue.ruleId, issue.message])).values()
            );

            const totalExposureValue = uniqueRuleMessages.reduce((sum, message) => {
                const match = message.match(/(?:total exposure of|exposure:)\s*\$?([\d,.]+(?:\.\d{2})?)/i);
                if (match) {
                    return sum + parseFloat(match[1].replace(/,/g, ''));
                }
                return sum;
            }, 0);

            totalExposureStr = `$${totalExposureValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

            await prisma.diagnosticRun.update({
                where: { id: latestRun.id },
                data: {
                    metadata: {
                        criticalCount,
                        warningCount,
                        infoCount,
                        entitiesAffected: totalEntities,
                        totalExposure: totalExposureStr
                    }
                }
            }).catch(err => console.error('Failed to self-heal diagnostic run metadata:', err));
        }

        const scoreBreakdown = HealthScoreCalculator.calculate(latestRun.checks as any);
        const isLocked = connection.subscriptionStatus !== 'ACTIVE';

        return res.json({
            success: true,
            data: {
                locked: isLocked,
                id: latestRun.id,
                runId: latestRun.id,
                runAt: latestRun.runAt ? new Date(latestRun.runAt).toISOString() : new Date().toISOString(),
                lastRunAt: latestRun.runAt ? new Date(latestRun.runAt).toISOString() : new Date().toISOString(),
                healthScore: scoreBreakdown.score,
                scoreLabel: scoreBreakdown.grade,
                scoreColor: scoreBreakdown.color,
                scoreBreakdown,
                criticalCount: criticalCount || 0,
                warningCount: warningCount || 0,
                infoCount: infoCount || 0,
                issueCount,
                totalIssues: issueCount,
                totalEntities: totalEntities || 0,
                affectedEntitiesCount: totalEntities || 0,
                totalExposure: totalExposureStr,
                summary: {
                    totalIssues: issueCount,
                    criticalCount: criticalCount || 0,
                    warningCount: warningCount || 0,
                    infoCount: infoCount || 0,
                    affectedEntitiesCount: totalEntities || 0,
                    totalEntities: totalEntities || 0,
                    totalExposure: totalExposureStr
                },
                // Conditional inclusion based on lock status
                checks: isLocked ? [] : latestRun.checks,
                issues: isLocked ? [] : latestRun.issues.map(issue => ({
                    id: issue.id,
                    ruleId: issue.ruleId,
                    ruleName: issue.ruleName,
                    severity: issue.severity,
                    message: issue.message,
                    entityCount: Array.isArray(issue.entities) ? issue.entities.length : 0,
                    isResolved: issue.isResolved
                }))
            }
        });

        // ... (rest of the handler code remains the same)
    } catch (error) {
        return next(error);
    }
});
router.get('/history/:connectionId', async (req: AuthRequest, res: Response, next) => {
    try {
        const { connectionId } = req.params;
        const { tenantId } = req;
        const limit = parseInt(req.query.limit as string) || 30;

        const connection = await prisma.qbConnection.findUnique({
            where: { id: connectionId }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        const history = await prisma.diagnosticRun.findMany({
            where: { tenantId, connectionId },
            orderBy: { runAt: 'desc' },
            take: limit,
            select: {
                id: true,
                runAt: true,
                healthScore: true,
                status: true
            }
        });

        return res.json({
            success: true,
            data: history
        });
    } catch (error) {
        return next(error);
    }
});

router.get('/logs/:connectionId', async (req: AuthRequest, res: Response, next) => {
    try {
        const { connectionId } = req.params;
        const { tenantId } = req;
        const limit = parseInt(req.query.limit as string) || 100;

        const connection = await prisma.qbConnection.findUnique({
            where: { id: connectionId }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        const syncLogs = await prisma.syncLog.findMany({
            where: { realmId: connection.realmId },
            orderBy: { createdAt: 'desc' },
            take: limit
        });

        const issues = await prisma.issue.findMany({
            where: { connectionId },
            orderBy: { createdAt: 'desc' },
            take: limit
        });

        const consolidatedLogs = [
            ...syncLogs.map(log => ({
                id: log.id,
                type: 'SYNC',
                severity: log.status === 'FAILED' ? 'ERROR' : 'INFO',
                source: log.entityType,
                message: log.status === 'FAILED'
                    ? `Sync failed for ${log.entityType}: ${log.errorMessage}`
                    : `Successfully synced ${log.recordsSynced} ${log.entityType} records`,
                timestamp: log.createdAt
            })),
            ...issues.map(issue => ({
                id: issue.id,
                type: 'DIAGNOSTIC',
                severity: issue.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING',
                source: issue.ruleName,
                message: issue.message,
                timestamp: issue.createdAt
            }))
        ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, limit);

        return res.json({
            success: true,
            data: consolidatedLogs
        });
    } catch (error) {
        return next(error);
    }
});

router.get('/stream/:connectionId', async (req: AuthRequest, res: Response, next) => {
    try {
        const { connectionId } = req.params;
        const { tenantId } = req;

        const connection = await prisma.qbConnection.findUnique({
            where: { id: connectionId }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        res.write(`data: {"type": "ping"}\n\n`);

        const keepAliveInterval = setInterval(() => {
            res.write(`data: {"type": "ping"}\n\n`);
        }, 30000);

        const onRunCompleted = (data: { runId: string }) => {
            res.write(`data: {"type": "run_completed", "runId": "${data.runId}"}\n\n`);
        };

        sseEventEmitter.on(`run_completed:${connectionId}`, onRunCompleted);

        req.on('close', () => {
            clearInterval(keepAliveInterval);
            sseEventEmitter.off(`run_completed:${connectionId}`, onRunCompleted);
            res.end();
        });
    } catch (error) {
        return next(error);
    }
});

export default router;