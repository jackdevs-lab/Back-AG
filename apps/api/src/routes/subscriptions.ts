import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { prisma } from '@qb-health/financial-model';
import { AppError } from '../middleware/error-handler';
import { AuthRequest } from '../middleware/auth';
import { paystackService } from '../services/paystack.service';

const router: Router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/subscriptions/checkout
// ─────────────────────────────────────────────────────────────────────────────
router.post(
    '/checkout',
    body('connectionId').isString().notEmpty().withMessage('connectionId is required'),
    body('planCode').optional().isString(),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                throw new AppError(errors.array()[0].msg, 400);
            }

            const { connectionId, planCode = 'PLN_DEFAULT' } = req.body;
            const { tenantId, userId } = req;

            const connection = await prisma.qbConnection.findUnique({
                where: { id: connectionId },
                include: { tenant: true }
            });

            if (!connection || connection.tenantId !== tenantId) {
                throw new AppError('Connection not found', 404);
            }

            const email = connection.tenant.email;
            if (!email) {
                throw new AppError('Tenant email not found', 400);
            }

            const checkoutData = await paystackService.initializeTransaction(
                email,
                connection.id,
                connection.realmId,
                userId || tenantId!,
                planCode
            );

            res.json({
                success: true,
                data: {
                    authorizationUrl: checkoutData.authorization_url,
                    accessCode: checkoutData.access_code,
                    reference: checkoutData.reference
                }
            });
        } catch (error) {
            next(error);
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/subscriptions/mock-activate  (DEV / TEST ONLY)
// ─────────────────────────────────────────────────────────────────────────────
router.get(
    '/mock-activate',
    query('connectionId').isString().notEmpty(),
    query('planCode').optional().isString(),
    async (req: AuthRequest, res: Response, next) => {
        try {
            if (process.env.NODE_ENV === 'production' || process.env.MOCK_BILLING !== 'true') {
                throw new AppError('Not found', 404);
            }

            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                throw new AppError('connectionId query param is required', 400);
            }

            const connectionId = req.query.connectionId as string;
            const planCode = (req.query.planCode as string) || 'PLN_DEFAULT';

            const connection = await prisma.qbConnection.findUnique({
                where: { id: connectionId }
            });

            if (!connection) {
                throw new AppError('Connection not found', 404);
            }

            await paystackService.mockActivate(connectionId, planCode);

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.redirect(`${frontendUrl}/connections/success?mock=true&connectionId=${connectionId}`);
        } catch (error) {
            next(error);
        }
    }
);

export default router;