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
                select: {
                    ruleId: true,
                    severity: true,
                    message: true,
                    _count: { select: { entities: true } },
                }
            });

            criticalCount = allIssuesSummary.filter(i => i.severity === 'CRITICAL').length;
            warningCount = allIssuesSummary.filter(i => i.severity === 'WARNING').length;
            infoCount = allIssuesSummary.filter(i => i.severity === 'INFO').length;
            totalEntities = allIssuesSummary.reduce((sum, i) => sum + i._count.entities, 0);

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

        // 1. Fetch the latest fully completed diagnostic run.
        //    Issues include only a _count of the entities relation — we never
        //    need the entity rows themselves on this endpoint.
        const latestRun = await prisma.diagnosticRun.findFirst({
            where: {
                tenantId,
                connectionId,
                status: 'COMPLETED'
            },
            orderBy: { runAt: 'desc' },
            include: {
                issues: {
                    orderBy: { severity: 'desc' },
                    take: 50,
                    include: {
                        _count: { select: { entities: true } },
                    },
                },
                checks: true,
            }
        });

        if (!latestRun) {
            return res.json({
                success: true,
                data: {
                    status: 'PENDING',
                    issues: [],
                    checks: []
                },
                message: 'No completed diagnostic runs found'
            });
        }

        // 2. Prepare the summary/teaser metadata
        const metadata = (latestRun.metadata as any) || {};
        let criticalCount: number | undefined = metadata.criticalCount;
        let warningCount: number | undefined = metadata.warningCount;
        let infoCount: number | undefined = metadata.infoCount;
        let totalEntities: number | undefined = metadata.entitiesAffected;
        let totalExposureStr: string | undefined = metadata.totalExposure;

        const isMetadataComplete =
            criticalCount !== undefined &&
            warningCount !== undefined &&
            infoCount !== undefined &&
            totalEntities !== undefined &&
            totalExposureStr !== undefined;

        let issueCount = isMetadataComplete
            ? (criticalCount! + warningCount! + infoCount!)
            : 0;

        // Fallback logic if metadata is incomplete.
        // Uses _count instead of loading the entities relation so we never
        // materialise entity rows just to compute a total.
        if (!isMetadataComplete) {
            const allIssuesSummary = await prisma.issue.findMany({
                where: { runId: latestRun.id },
                select: {
                    ruleId: true,
                    severity: true,
                    message: true,
                    _count: { select: { entities: true } },
                }
            });

            criticalCount = allIssuesSummary.filter(i => i.severity === 'CRITICAL').length;
            warningCount = allIssuesSummary.filter(i => i.severity === 'WARNING').length;
            infoCount = allIssuesSummary.filter(i => i.severity === 'INFO').length;
            totalEntities = allIssuesSummary.reduce((sum, i) => sum + i._count.entities, 0);
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
                criticalCount: criticalCount ?? 0,
                warningCount: warningCount ?? 0,
                infoCount: infoCount ?? 0,
                issueCount,
                totalIssues: issueCount,
                totalEntities: totalEntities ?? 0,
                affectedEntitiesCount: totalEntities ?? 0,
                totalExposure: totalExposureStr,
                summary: {
                    totalIssues: issueCount,
                    criticalCount: criticalCount ?? 0,
                    warningCount: warningCount ?? 0,
                    infoCount: infoCount ?? 0,
                    affectedEntitiesCount: totalEntities ?? 0,
                    totalEntities: totalEntities ?? 0,
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
                    entityCount: issue._count.entities,
                    isResolved: issue.isResolved
                }))
            }
        });
    } catch (error) {
        return next(error);
    }
});
router.get('/runs/:runId/issues', async (req: AuthRequest, res: Response, next) => {
    try {
        const { runId } = req.params;
        const { tenantId } = req;
        const { ruleId, severity, limit = '100', offset = '0' } = req.query;

        const parsedLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
        const parsedOffset = Math.max(Number(offset) || 0, 0);

        const run = await prisma.diagnosticRun.findFirst({
            where: { id: runId, tenantId },
            select: { id: true },
        });
        if (!run) throw new AppError('Run not found', 404);

        const where = {
            runId,
            ...(ruleId ? { ruleId: String(ruleId) } : {}),
            ...(severity ? { severity: String(severity) } : {}),
        };

        const [total, issues] = await Promise.all([
            prisma.issue.count({ where }),
            prisma.issue.findMany({
                where,
                orderBy: [{ severity: 'desc' }, { id: 'asc' }],
                take: parsedLimit,
                skip: parsedOffset,
                select: {
                    id: true,
                    ruleId: true,
                    ruleName: true,
                    severity: true,
                    message: true,
                    isResolved: true,
                    deepLink: true,
                    metadata: true, // Now valid after schema update
                    entities: {
                        select: { entityId: true }
                    },
                    _count: {
                        select: { entities: true }
                    },
                },
            }),
        ]);

        res.json({
            success: true,
            data: {
                total,
                limit: parsedLimit,
                offset: parsedOffset,
                issues: issues.map((issue) => {
                    const meta = (issue.metadata as any) || {};

                    return {
                        id: issue.id,
                        ruleId: issue.ruleId,
                        ruleName: issue.ruleName,
                        severity: issue.severity,
                        message: issue.message,
                        isResolved: issue.isResolved,
                        deepLink: issue.deepLink,
                        entityCount: issue._count.entities,
                        entityIds: issue.entities.map(e => e.entityId),

                        // NEW: Expose the amount and currency to the frontend
                        exposureAmount: Number(meta.exposureAmount ?? 0),
                        currency: meta.currency ?? 'USD',
                    };
                }),
            },
        });
    } catch (error) {
        return next(error);
    }
});
router.get('/runs/:runId/rules', async (req: AuthRequest, res: Response, next) => {
    try {
        const { runId } = req.params;
        const { tenantId } = req;

        const run = await prisma.diagnosticRun.findFirst({
            where: { id: runId, tenantId },
            select: { id: true },
        });
        if (!run) throw new AppError('Run not found', 404);

        // 1. Get basic grouping
        const grouped = await prisma.issue.groupBy({
            by: ['ruleId', 'ruleName', 'severity'],
            where: { runId },
            _count: { _all: true },
        });

        // 2. Entity counts per rule using raw SQL (efficient)
        const entityCounts = await prisma.$queryRaw<
            { ruleId: string; entityCount: bigint }[]
        >`
            SELECT i."ruleId" AS "ruleId", COUNT(e.id)::bigint AS "entityCount"
            FROM "Issue" i
            LEFT JOIN "IssueEntity" e ON e."issueId" = i.id
            WHERE i."runId" = ${runId}
            GROUP BY i."ruleId"
        `;
        const entityMap = new Map(
            entityCounts.map(r => [r.ruleId, Number(r.entityCount)])
        );

        // 3. Aggregate financial exposure per rule from metadata
        const issuesForExposure = await prisma.issue.findMany({
            where: { runId },
            select: {
                ruleId: true,
                metadata: true,
            }
        });

        const exposureMap = new Map<string, { amount: number; currency: string }>();

        for (const issue of issuesForExposure) {
            const meta = (issue.metadata as any) || {};
            const amount = Number(meta.exposureAmount || 0);
            const currency = meta.currency || 'USD';

            if (!exposureMap.has(issue.ruleId)) {
                exposureMap.set(issue.ruleId, { amount: 0, currency });
            }
            const current = exposureMap.get(issue.ruleId)!;
            current.amount += amount;
        }

        // 4. Build the final rule breakdown
        const SEVERITY_RANK: Record<string, number> = { CRITICAL: 3, WARNING: 2, INFO: 1 };
        const byRule = new Map<string, any>();

        for (const g of grouped) {
            const existing = byRule.get(g.ruleId);
            const exposureData = exposureMap.get(g.ruleId) || { amount: 0, currency: 'USD' };

            if (!existing) {
                byRule.set(g.ruleId, {
                    ruleId: g.ruleId,
                    ruleName: g.ruleName,
                    severity: g.severity,
                    issueCount: g._count._all,
                    entityCount: entityMap.get(g.ruleId) ?? 0,
                    ruleExposureAmount: exposureData.amount,
                    currency: exposureData.currency,
                });
            } else {
                existing.issueCount += g._count._all;
                existing.ruleExposureAmount += exposureData.amount;

                const cur = SEVERITY_RANK[g.severity] ?? 0;
                const prev = SEVERITY_RANK[existing.severity] ?? 0;
                if (cur > prev) existing.severity = g.severity;
            }
        }

        const rules = [...byRule.values()].sort((a, b) =>
            (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
        );

        res.json({ success: true, data: { rules } });
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