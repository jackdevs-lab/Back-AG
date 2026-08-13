import express, { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest, clerkClient } from '../middleware/auth';
import connectionsRouter from './connections';
import authRouter from './auth';
import diagnosticsRouter from './diagnostics';
import { oauthService } from '@qb-health/qb-client';
import { logger } from '@qb-health/utils';
import { AppError } from '../middleware/error-handler';
import { syncQueue } from '../queue';
import reportsRouter from './reports';
import webhooksRouter from './webhooks';
import subscriptionsRouter from './subscriptions';
import { prisma } from '@qb-health/financial-model';

const router: Router = Router();

// Public routes
router.use('/auth', authRouter);

// Mounted webhooks router with express.raw() to preserve the raw body for HMAC signature verification
router.use('/webhooks', express.raw({ type: 'application/json' }), webhooksRouter);

router.get('/version', (req, res) => {
    res.json({
        version: '1.0.1',
        timestamp: new Date().toISOString()
    });
});

router.get('/launch', (req: Request, res: Response) => {
    logger.info('Intuit launch URL triggered', { rawQuery: req.query });
    const frontendUrl = process.env.FRONTEND_URL;

    if (!frontendUrl) {
        return res.status(500).send('Frontend URL is not configured');
    };
    return res.redirect(`${frontendUrl}/dashboard`);
});

router.get('/qb/disconnect-callback', (req: Request, res: Response) => {
    const realmId = String(
        req.query.realmId ||
        req.query.realmid ||
        req.query.realm_id ||
        ''
    ).trim();

    logger.info('QuickBooks external disconnect callback received', {
        hasRealmId: Boolean(realmId),
    });

    const frontendUrl = process.env.FRONTEND_URL;

    if (!frontendUrl) {
        logger.error('FRONTEND_URL is not configured');
        return res.status(500).send('Frontend URL is not configured');
    }

    const redirectUrl = realmId
        ? `${frontendUrl}/disconnect?realmId=${encodeURIComponent(realmId)}`
        : `${frontendUrl}/disconnect`;

    return res.redirect(redirectUrl);
});

// Protected routes
router.use(authMiddleware);

// QuickBooks OAuth routes (Now protected to ensure JIT provisioning)
router.get('/qb/auth-url', (req: AuthRequest, res: Response) => {
    const tenantId = req.tenantId; // Use verified tenantId from middleware

    logger.info('OAuth URL requested', { tenantId });
    const state = Buffer.from(JSON.stringify({
        tenantId,
        timestamp: Date.now()
    })).toString('base64');

    const authUrl = oauthService.getAuthUrl(state);
    res.json({ success: true, authUrl });
});

router.post('/connections/quickbooks/callback', async (req: AuthRequest, res: Response, next) => {
    try {
        const { code, realmId, state } = req.body;
        if (!code || !realmId || !state) throw new AppError('Invalid callback data', 400);

        const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
        const stateTenantId = stateData.tenantId;

        if (stateTenantId !== req.tenantId) {
            logger.warn('OAuth Callback: Tenant ID mismatch between state and authenticated user', {
                stateTenantId,
                authTenantId: req.tenantId
            });
            throw new AppError('Invalid session state. Please try connecting again.', 403);
        }

        const tenantId = stateTenantId;

        const tokenData = await oauthService.exchangeCodeForToken(code);

        let tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

        if (!tenant) {
            logger.info(`OAuth Callback: JIT provisioning fallback for tenant ${tenantId}...`);
            try {
                if (tenantId.startsWith('org_')) {
                    const org = await clerkClient.organizations.getOrganization({ organizationId: tenantId });
                    tenant = await prisma.tenant.create({
                        data: {
                            id: tenantId,
                            name: org.name,
                            email: `org_${tenantId}@clerk.system`
                        }
                    });
                } else if (tenantId.startsWith('user_')) {
                    const user = await clerkClient.users.getUser(tenantId);
                    tenant = await prisma.tenant.create({
                        data: {
                            id: tenantId,
                            name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'New User',
                            email: user.emailAddresses[0]?.emailAddress || `user_${tenantId}@clerk.system`,
                            isBypassed: user.emailAddresses[0]?.emailAddress === 'intuit-review@auditorgen.com'
                        }
                    });
                } else {
                    throw new Error(`Invalid tenant ID format: ${tenantId}`);
                }
                logger.info(`OAuth Callback: Successfully provisioned tenant ${tenantId}`);
            } catch (provisionError: any) {
                logger.error('OAuth Callback: JIT Provisioning failed:', {
                    error: provisionError.message || provisionError,
                    code: provisionError.code,
                    tenantId: tenantId
                });
                throw new AppError('Failed to initialize workspace context. Please contact support.', 500);
            }
        }

        await oauthService.saveConnection(tenantId, realmId, tokenData);

        const isBypassedTenant = tenant?.isBypassed || tenant?.email === 'intuit-review@auditorgen.com';
        if (isBypassedTenant) {
            await prisma.qbConnection.updateMany({
                where: { tenantId, realmId },
                data: { subscriptionStatus: 'ACTIVE' }
            });
        }

        // 5. Trigger initial sync
        await syncQueue.add('trigger-sync', { realmId, tenantId, type: 'initial' });

        res.json({
            success: true,
            message: 'Connected',
            redirectUrl: `${process.env.FRONTEND_URL}/connections/success?realmId=${realmId}`
        });
    } catch (error) {
        next(error);
    }
});

router.use('/connections', connectionsRouter);
router.use('/diagnostics', diagnosticsRouter);
router.use('/reports', reportsRouter);
router.use('/subscriptions', subscriptionsRouter);

export default router;