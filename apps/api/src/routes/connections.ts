import { Router, Response } from 'express';
import { prisma } from '@qb-health/financial-model';
import { AppError } from '../middleware/error-handler';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { syncQueue } from '../queue';
import { decrypt, logger } from '@qb-health/utils';
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
        const connections = await prisma.qbConnection.findMany({
            where: { tenantId }
        });

        // Dynamically set the Intuit API URL based on the environment
        const QB_BASE_URL = process.env.QB_ENVIRONMENT?.toLowerCase() === 'sandbox'
            ? 'https://sandbox-quickbooks.api.intuit.com'
            : 'https://quickbooks.api.intuit.com';

        for (const conn of connections) {
            try {
                // Lightweight ping to QuickBooks to test if the token is still valid
                const response = await fetch(
                    `${QB_BASE_URL}/v3/company/${conn.realmId}/companyinfo/${conn.realmId}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${conn.accessToken}`,
                            'Accept': 'application/json'
                        }
                    }
                );

                // If QuickBooks revokes access, it returns a 401 Unauthorized
                if (response.status === 401) {
                    logger.warn(`Token expired or revoked externally for realmId: ${conn.realmId}. Purging.`);
                    await prisma.qbConnection.delete({ where: { id: conn.id } });
                }
            } catch (apiError) {
                logger.error(`Failed to verify QB connection health for realmId: ${conn.realmId}`, apiError);
            }
        }

        return res.status(200).json({ success: true, message: 'Sync check complete' });
    } catch (error) {
        logger.error('Error in verify-and-sync route', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});
// Inside apps/api/src/routes/connections.ts (GET /:id/status route)

router.get('/:id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
    const { id } = req.params;
    const { tenantId } = req;

    const connection = await prisma.qbConnection.findUnique({ where: { id } });
    if (!connection || connection.tenantId !== tenantId) {
        return res.status(404).json({ error: 'Connection not found' });
    }

    try {
        // Quick health check against Intuit
        const qbCheck = await fetch(
            `https://sandbox-quickbooks.api.intuit.com/v3/company/${connection.realmId}/companyinfo/${connection.realmId}`,
            {
                headers: { Authorization: `Bearer ${connection.accessToken}`, Accept: 'application/json' }
            }
        );

        if (qbCheck.status === 401) {
            // Self-heal: Automatically purge the dead connection on the spot
            await prisma.qbConnection.delete({ where: { id: connection.id } });
            logger.info(`Lazy cleanup purged revoked connection ID: ${id}`);
            return res.status(410).json({ error: 'Connection expired or revoked', disconnected: true });
        }

        return res.json({ status: 'ACTIVE', connectionStatus: connection.syncStatus });
    } catch (error) {
        logger.error('Error validating connection status', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

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
                refreshToken: true
            }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        try {
            const rawEncryptedToken = connection.refreshToken?.trim();
            const clientId = process.env.QB_CLIENT_ID?.trim();
            const clientSecret = process.env.QB_CLIENT_SECRET?.trim();

            if (rawEncryptedToken && clientId && clientSecret) {
                // 1. DECRYPT the stored refresh token first
                const decryptedRefreshToken = decrypt(rawEncryptedToken).trim();

                const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
                const revokeUrl = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';

                // 2. Pass the raw decrypted token to Intuit
                const formData = new URLSearchParams({
                    token: decryptedRefreshToken,
                    token_type_hint: 'refresh_token'
                });

                const revokeResponse = await fetch(revokeUrl, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': `Basic ${authHeader}`
                    },
                    body: formData.toString()
                });

                if (!revokeResponse.ok) {
                    const errorText = await revokeResponse.text();
                    console.warn(
                        `Intuit Token Revocation Failed (HTTP ${revokeResponse.status}):`,
                        errorText || '<Empty Body Received from Gateway>'
                    );
                } else {
                    console.log(`Successfully revoked Intuit token for connection ${id}`);
                }
            } else {
                console.warn('Skipping Intuit revocation: Missing client credentials or refresh token.');
            }
        } catch (revokeError) {
            console.warn('Error during Intuit token decryption or revocation:', revokeError);
        }

        // 3. Delete local connection record
        await prisma.qbConnection.delete({
            where: { id }
        });

        res.json({
            success: true,
            message: 'Connection deleted'
        });
    } catch (error) {
        next(error);
    }
});
// PATCH connection
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