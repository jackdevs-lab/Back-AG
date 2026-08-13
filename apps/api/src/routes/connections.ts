import { Router, Response } from 'express';
import { prisma } from '@qb-health/financial-model';
import { AppError } from '../middleware/error-handler';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { syncQueue } from '../queue';
import { decrypt, logger } from '@qb-health/utils';
import { oauthService } from '@qb-health/qb-client';
import { deleteConnectionData } from '../services/connection-cleanup';
const router: Router = Router();
const QB_BASE_URL = process.env.QB_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';
// GET all connections for the current tenant
router.get('/', async (req: AuthRequest, res: Response, next) => {
    try {
        const { tenantId } = req;

        const connections = await prisma.qbConnection.findMany({
            where: { tenantId },
            select: {
                id: true,
                realmId: true,
                companyName: true,
                lastSyncAt: true,
                syncStatus: true,
                isActive: true,
                subscriptionStatus: true,
                createdAt: true,
                updatedAt: true,
                lastSyncMessage: true
            }
        });

        res.json({
            success: true,
            data: connections
        });
    } catch (error) {
        next(error);
    }
});

// GET single connection by ID
router.get('/:id', async (req: AuthRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const { tenantId } = req;

        const connection = await prisma.qbConnection.findUnique({
            where: { id },
            include: {
                issues: {
                    take: 10,
                    orderBy: { createdAt: 'desc' }
                }
            }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        res.json({
            success: true,
            data: connection
        });
    } catch (error) {
        next(error);
    }
});

// GET connection status with tenant validation
router.get('/:id/status', async (req: AuthRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const { tenantId } = req;

        const status = await prisma.qbConnection.findUnique({
            where: { id },
            select: { syncStatus: true, lastSyncMessage: true, tenantId: true }
        });

        if (!status || status.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        const { tenantId: _, ...cleanStatus } = status;
        res.json(cleanStatus);
    } catch (error) {
        next(error);
    }
});

// GET connection overview
router.get('/:id/overview', async (req: AuthRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const { tenantId } = req;

        const connection = await prisma.qbConnection.findUnique({
            where: { id },
            select: {
                id: true,
                companyName: true,
                realmId: true,
                tenantId: true,
                syncStatus: true,
                subscriptionStatus: true,
                lastSyncAt: true,
                lastSyncMessage: true,
                createdAt: true,
                updatedAt: true,
                isActive: true,
                _count: {
                    select: { issues: true }
                }
            }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        res.json({
            success: true,
            data: connection
        });
    } catch (error) {
        next(error);
    }
});

// Safety-net endpoint to verify token health and purge if revoked
router.post('/verify-and-sync', async (req: AuthRequest, res: Response) => {
    try {
        const tenantId = req.tenantId;
        const { realmId } = req.body;

        if (!tenantId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized',
            });
        }

        if (!realmId || typeof realmId !== 'string') {
            return res.status(400).json({
                success: false,
                message: 'realmId is required',
            });
        }

        const connection = await prisma.qbConnection.findFirst({
            where: {
                tenantId,
                realmId,
            },
            select: {
                id: true,
                tenantId: true,
                realmId: true,
            },
        });

        if (!connection) {
            throw new AppError('Connection not found', 404);
        }

        const environment = process.env.QB_ENVIRONMENT?.toLowerCase();

        if (environment !== 'sandbox' && environment !== 'production') {
            logger.error('Invalid QB_ENVIRONMENT configuration', {
                environment,
            });

            return res.status(500).json({
                success: false,
                message: 'Invalid QuickBooks environment configuration',
            });
        }

        const qbBaseUrl =
            environment === 'sandbox'
                ? 'https://sandbox-quickbooks.api.intuit.com'
                : 'https://quickbooks.api.intuit.com';

        try {
            const accessToken = await oauthService.refreshIfNeeded(
                connection.realmId,
                tenantId
            );

            const response = await fetch(
                `${qbBaseUrl}/v3/company/${connection.realmId}/companyinfo/${connection.realmId}`,
                {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: 'application/json',
                    },
                }
            );

            if (response.ok) {
                return res.json({
                    success: true,
                    connected: true,
                    message: 'QuickBooks connection is still active',
                });
            }

            if (response.status === 401) {
                logger.warn('QuickBooks authorization revoked', {
                    tenantId,
                    realmId: connection.realmId,
                    connectionId: connection.id,
                });

                await deleteConnectionData(connection.id);

                return res.json({
                    success: true,
                    connected: false,
                    message: 'QuickBooks connection has been removed',
                });
            }

            logger.warn('QuickBooks connection verification returned non-success', {
                tenantId,
                realmId: connection.realmId,
                status: response.status,
            });

            return res.status(502).json({
                success: false,
                message: 'Unable to verify QuickBooks connection',
            });
        } catch (error) {
            logger.error('QuickBooks connection verification failed', error);

            return res.status(502).json({
                success: false,
                message: 'Unable to verify QuickBooks connection',
            });
        }
    } catch (error) {
        logger.error('Error in verify-and-sync route', error);
        return res.status(500).json({
            error: 'Internal Server Error',
        });
    }
});
// Inside apps/api/src/routes/connections.ts (GET /:id/status route)



// DELETE connection
// DELETE connection
// DELETE connection
// DELETE connection
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const { tenantId } = req;

        const connection = await prisma.qbConnection.findUnique({
            where: { id },
            select: {
                id: true,
                tenantId: true,
                refreshToken: true,
                realmId: true,
            },
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        // Revoke the QuickBooks refresh token
        try {
            const rawEncryptedToken = connection.refreshToken?.trim();
            const clientId = process.env.QB_CLIENT_ID?.trim();
            const clientSecret = process.env.QB_CLIENT_SECRET?.trim();

            if (rawEncryptedToken && clientId && clientSecret) {
                const decryptedRefreshToken = decrypt(rawEncryptedToken).trim();

                const authHeader = Buffer
                    .from(`${clientId}:${clientSecret}`)
                    .toString('base64');

                const revokeResponse = await fetch(
                    'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
                    {
                        method: 'POST',
                        headers: {
                            Accept: 'application/json',
                            'Content-Type': 'application/json',
                            Authorization: `Basic ${authHeader}`,
                        },
                        body: JSON.stringify({
                            token: decryptedRefreshToken,
                        }),
                    }
                );

                if (!revokeResponse.ok) {
                    const errorText = await revokeResponse.text();

                    logger.warn('Intuit token revocation failed', {
                        connectionId: id,
                        status: revokeResponse.status,
                        error: errorText || '<empty response>',
                    });
                }
            } else {
                logger.warn('Skipping Intuit token revocation', {
                    connectionId: id,
                    reason: 'Missing refresh token or Intuit client credentials',
                });
            }
        } catch (revokeError) {
            logger.warn('Error during Intuit token revocation', {
                connectionId: id,
                error: revokeError,
            });

            // Continue with local cleanup even if Intuit revocation fails.
        }

        // Centralized local cleanup
        const deleted = await deleteConnectionData(id);

        if (!deleted) {
            throw new AppError('Connection not found', 404);
        }

        return res.status(200).json({
            success: true,
            message: 'Connection and associated data deleted',
        });
    } catch (error) {
        return next(error);
    }
});

router.patch('/:id', async (req: AuthRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const { tenantId } = req;
        const { companyName } = req.body;

        if (!companyName) {
            throw new AppError('Company name is required', 400);
        }

        const connection = await prisma.qbConnection.findUnique({
            where: { id }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        const updated = await prisma.qbConnection.update({
            where: { id },
            data: { companyName }
        });

        res.json({
            success: true,
            data: updated,
            message: 'Connection updated'
        });
    } catch (error) {
        next(error);
    }
});

// POST sync trigger (Bulletproofed with fallback array for sandbox bypass)
// POST sync trigger 
router.post('/:id/sync', async (req: AuthRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const { tenantId } = req;

        // Fetch connection AND the tenant to check the isBypassed flag
        const connection = await prisma.qbConnection.findUnique({
            where: { id },
            include: { tenant: true }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        // 1. Validate subscription status with bypass logic
        const isSandboxEnv = process.env.QB_ENVIRONMENT?.toLowerCase() === 'sandbox';
        const allowedDemoRealms = [process.env.INTUIT_DEMO_REALM_ID].filter(Boolean);
        const isDemoSandbox = allowedDemoRealms.includes(connection.realmId);
        const isBypassed = connection.tenant?.isBypassed || false;

        // Block ONLY if they have no active sub AND aren't hitting a sandbox/reviewer bypass
        if (connection.subscriptionStatus !== 'ACTIVE' && !isDemoSandbox && !isSandboxEnv && !isBypassed) {
            res.status(402).json({
                success: false,
                code: 'UPGRADE_REQUIRED',
                message: 'An active subscription is required to run a manual audit sync.',
                upgradeRequired: true
            });
            return;
        }

        // 2. Prevent overlapping syncs based on database status
        if (connection.syncStatus === 'SYNCING') {
            throw new AppError('A sync is already in progress for this company.', 409);
        }

        // 3. 5-Minute Sync Cooldown Check
        if (connection.updatedAt) {
            const timeDelta = Date.now() - connection.updatedAt.getTime();
            const COOLDOWN_MS = 6000; // 5 minutes

            if (timeDelta < COOLDOWN_MS) {
                const retryAfterSeconds = Math.ceil((COOLDOWN_MS - timeDelta) / 1000);
                res.status(429).json({
                    error: "Cooldown active",
                    retryAfterSeconds
                });
                return;
            }
        }

        // REMOVED THE OPTIMISTIC prisma.qbConnection.update HERE.
        // Let the worker set it to SYNCING safely when it actually starts.

        // 4. Queue the sync job
        const job = await syncQueue.add('trigger-sync', {
            realmId: connection.realmId,
            tenantId,
            type: 'manual',
            connectionId: id
        }, {
            jobId: `sync-${id}-${Date.now()}`
        });

        res.json({
            success: true,
            jobId: job.id,
            message: 'Sync queued'
        });
    } catch (error) {
        next(error);
    }
});

export default router;