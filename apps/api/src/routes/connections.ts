import { Router, Response } from 'express';
import { prisma } from '@qb-health/financial-model';
import { AppError } from '../middleware/error-handler';
import { AuthRequest } from '../middleware/auth';
import { syncQueue } from '../queue';

const router: Router = Router();

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

// DELETE connection
// DELETE connection
router.delete('/:id', async (req: AuthRequest, res: Response, next) => {
    try {
        const { id } = req.params;
        const { tenantId } = req;

        // 1. Fetch connection, explicitly selecting the refreshToken
        const connection = await prisma.qbConnection.findUnique({
            where: { id },
            select: {
                id: true,
                tenantId: true,
                refreshToken: true // Target the refresh token directly from the schema
            }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        // 2. Revoke the OAuth Token with Intuit
        try {
            if (connection.refreshToken) {
                const clientId = process.env.QB_CLIENT_ID;
                const clientSecret = process.env.QB_CLIENT_SECRET;
                const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

                // Use the correct v2 developer API endpoint
                const revokeResponse = await fetch('https://developer.api.intuit.com/v2/oauth2/tokens/revoke', {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'Authorization': `Basic ${authHeader}`
                    },
                    body: JSON.stringify({ token: connection.refreshToken })
                });

                if (!revokeResponse.ok) {
                    const errorText = await revokeResponse.text();
                    console.error('Intuit Token Revocation Failed:', errorText);

                    // Throw an error instead of silently failing!
                    // If Intuit fails to revoke, we abort and keep the local record intact.
                    throw new AppError('Failed to disconnect from QuickBooks. Please try again.', 500);
                }
            }
        } catch (revokeError) {
            console.error('Error during Intuit token revocation:', revokeError);
            // Bubble the error up to the global error handler
            throw revokeError;
        }

        // 3. Delete the local database record
        // This will now ONLY run if the Intuit revocation succeeds
        await prisma.qbConnection.delete({
            where: { id }
        });

        res.json({
            success: true,
            message: 'Connection deleted and token revoked'
        });

        // ... catch block ...
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

        const connection = await prisma.qbConnection.findUnique({
            where: { id }
        });

        if (!connection || connection.tenantId !== tenantId) {
            throw new AppError('Connection not found', 404);
        }

        // 1. Validate subscription status 
        const allowedDemoRealms = [process.env.INTUIT_DEMO_REALM_ID].filter(Boolean);
        const isDemoSandbox = allowedDemoRealms.includes(connection.realmId);

        if (connection.subscriptionStatus !== 'ACTIVE' && !isDemoSandbox) {
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
            const COOLDOWN_MS = 300000; // 5 minutes

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