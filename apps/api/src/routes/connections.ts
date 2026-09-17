import { Router, Response } from 'express';
import { prisma } from '@qb-health/financial-model';
import { AppError } from '../middleware/error-handler';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { syncQueue } from '../queue';
import { decrypt, logger } from '@qb-health/utils';
import { oauthService } from '@qb-health/qb-client';
import { deleteConnectionData } from '../services/connection-cleanup';
import crypto from 'crypto';

export const SYNC_COOLDOWN_MS = 60_000;

const router: Router = Router();
const QB_BASE_URL = process.env.QB_ENVIRONMENT === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com';

// GET all connections for the current tenant
router.get('/', async (req: AuthRequest, res: Response, next) => {
    try {
        const { tenantId } = req;

        if (!tenantId) {
            res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
            return;
        }

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

        const activeConnections = [];

        for (const connection of connections) {
            try {
                await oauthService.refreshIfNeeded(connection.realmId, tenantId as string);
                activeConnections.push(connection);
            } catch (error: any) {
                const isRevoked = error?.response?.data?.error === 'invalid_grant' || error?.response?.status === 401;

                if (isRevoked) {
                    logger.warn('Connection verified as revoked on API fetch. Executing DB purge...', {
                        tenantId,
                        realmId: connection.realmId,
                        connectionId: connection.id
                    });

                    await deleteConnectionData(connection.id, tenantId as string);
                } else {
                    logger.error('Non-revocation error during connection health check', {
                        tenantId,
                        realmId: connection.realmId,
                        error: error?.message || error
                    });

                    activeConnections.push(connection);
                }
            }
        }

        res.json({
            success: true,
            data: activeConnections
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

        const connections = await prisma.qbConnection.findMany({
            where: {
                tenantId,
                ...(realmId && typeof realmId === 'string' ? { realmId } : {}),
            },
            select: {
                id: true,
                tenantId: true,
                realmId: true,
            },
        });

        if (!connections || connections.length === 0) {
            if (realmId) {
                throw new AppError('Connection not found', 404);
            }
            return res.status(200).json({
                success: true,
                connected: false,
                reason: 'NO_CONNECTIONS_FOUND',
                message: 'No active QuickBooks connections found',
            });
        }

        const environment = process.env.QB_ENVIRONMENT?.toLowerCase();
        if (environment !== 'sandbox' && environment !== 'production') {
            logger.error('Invalid QB_ENVIRONMENT configuration', { environment });
            return res.status(500).json({
                success: false,
                message: 'Invalid QuickBooks environment configuration',
            });
        }

        const qbBaseUrl =
            environment === 'sandbox'
                ? 'https://sandbox-quickbooks.api.intuit.com'
                : 'https://quickbooks.api.intuit.com';

        let anyConnected = false;
        let anyRevoked = false;

        for (const connection of connections) {
            let accessToken: string;

            try {
                accessToken = await oauthService.refreshIfNeeded(
                    connection.realmId,
                    tenantId
                );
            } catch (error: any) {
                logger.error('Unable to obtain QuickBooks access token', {
                    tenantId,
                    realmId: connection.realmId,
                    connectionId: connection.id,
                    error: error?.message || error,
                });

                const isRevoked = error?.response?.data?.error === 'invalid_grant' || error?.response?.status === 401;

                if (isRevoked) {
                    logger.warn('Refresh token rejected (invalid_grant). Executing DB purge...', {
                        tenantId,
                        realmId: connection.realmId,
                        connectionId: connection.id
                    });

                    await deleteConnectionData(connection.id, tenantId as string);
                    anyRevoked = true;
                }

                continue;
            }

            const checkQuickBooks = async (token: string) => {
                return fetch(
                    `${qbBaseUrl}/v3/company/${connection.realmId}/companyinfo/${connection.realmId}`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                            Accept: 'application/json',
                        },
                    }
                );
            };

            let qbResponse: globalThis.Response;
            try {
                qbResponse = await checkQuickBooks(accessToken);
            } catch (error) {
                logger.error('QuickBooks health check request failed', {
                    tenantId,
                    realmId: connection.realmId,
                    connectionId: connection.id,
                    error,
                });
                continue;
            }

            if (qbResponse.ok) {
                anyConnected = true;
                continue;
            }

            if (qbResponse.status === 401) {
                logger.warn('QuickBooks access token rejected; attempting forced refresh', {
                    tenantId,
                    realmId: connection.realmId,
                    connectionId: connection.id,
                });

                try {
                    const fullConnection = await oauthService.getConnection(
                        connection.realmId,
                        tenantId
                    );

                    const refreshedTokenData =
                        await oauthService.refreshAccessToken(
                            fullConnection.refreshToken
                        );

                    await oauthService.saveConnection(
                        tenantId,
                        connection.realmId,
                        refreshedTokenData
                    );

                    const retryResponse = await checkQuickBooks(
                        refreshedTokenData.access_token
                    );

                    if (retryResponse.ok) {
                        logger.info(
                            'QuickBooks authorization restored after token refresh',
                            { tenantId, realmId: connection.realmId }
                        );
                        anyConnected = true;
                        continue;
                    }

                    if (retryResponse.status === 401) {
                        logger.warn(
                            'QuickBooks rejected both original and refreshed authorization. Executing DB purge...',
                            { tenantId, realmId: connection.realmId }
                        );

                        await deleteConnectionData(connection.id, tenantId as string);
                        anyRevoked = true;
                    }
                } catch (refreshError) {
                    logger.warn(
                        'QuickBooks refresh failed after authorization rejection. Executing DB purge...',
                        {
                            tenantId,
                            realmId: connection.realmId,
                            error: refreshError,
                        }
                    );

                    await deleteConnectionData(connection.id, tenantId as string);
                    anyRevoked = true;
                }
            }
        }

        if (anyConnected) {
            return res.status(200).json({
                success: true,
                connected: true,
                reason: 'AUTHORIZED',
                message: 'QuickBooks connection is active',
            });
        }

        if (anyRevoked) {
            return res.status(200).json({
                success: true,
                connected: false,
                reason: 'AUTHORIZATION_REVOKED',
                message: 'QuickBooks authorization has been revoked and purged',
            });
        }

        return res.status(200).json({
            success: true,
            connected: false,
            reason: 'QUICKBOOKS_VERIFICATION_FAILED',
            message: 'QuickBooks connection could not be verified',
        });
    } catch (error) {
        logger.error('Error in verify-and-sync route', error);

        if (error instanceof AppError) {
            return res.status(error.statusCode).json({
                success: false,
                message: error.message,
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Internal Server Error',
        });
    }
});

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
        }

        const deleted = await deleteConnectionData(id, tenantId);

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

// POST sync trigger
router.post('/:id/sync', async (req: AuthRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const { tenantId } = req;

        const connection = await prisma.qbConnection.findUnique({
            where: { id },
            include: { tenant: true }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        const isSandboxEnv = process.env.QB_ENVIRONMENT?.toLowerCase() === 'sandbox';
        const allowedDemoRealms = [process.env.INTUIT_DEMO_REALM_ID].filter(Boolean);
        const isDemoSandbox = allowedDemoRealms.includes(connection.realmId);
        const isBypassed = connection.tenant?.isBypassed || false;

        if (connection.subscriptionStatus !== 'ACTIVE' && !isDemoSandbox && !isSandboxEnv && !isBypassed) {
            res.status(402).json({
                success: false,
                code: 'UPGRADE_REQUIRED',
                message: 'An active subscription is required to run a manual audit sync.',
                upgradeRequired: true
            });
            return;
        }

        const staleThreshold = new Date(Date.now() - 2 * 60_000);
        const isActivelySyncing = connection.syncStatus === 'SYNCING' &&
            connection.lastHeartbeatAt &&
            connection.lastHeartbeatAt > staleThreshold;

        if (isActivelySyncing) {
            res.status(409).json({
                success: false,
                error: 'Sync in progress',
                message: 'A sync is currently in progress for this connection.'
            });
            return;
        }

        if (connection.updatedAt) {
            const timeDelta = Date.now() - connection.updatedAt.getTime();

            if (timeDelta < SYNC_COOLDOWN_MS) {
                const retryAfterSeconds = Math.ceil((SYNC_COOLDOWN_MS - timeDelta) / 1000);
                res.status(429).json({
                    error: "Cooldown active",
                    retryAfterSeconds
                });
                return;
            }
        }

        // 1. Generate Correlation ID for E2E traceability
        const correlationId = crypto.randomUUID();

        const job = await syncQueue.add('trigger-sync', {
            realmId: connection.realmId,
            tenantId,
            type: 'manual',
            connectionId: id,
            correlationId // 2. Pass to worker
        }, {
            jobId: `sync:${id}`,
            removeOnComplete: true,
            removeOnFail: true
        });

        res.json({
            success: true,
            jobId: job.id,
            correlationId,
            message: 'Sync queued'
        });
    } catch (error) {
        next(error);
    }
});

export default router;