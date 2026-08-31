// apps/api/src/routes/subscriptions.ts
import { Router, Response } from 'express';
import { body, query, validationResult } from 'express-validator';
import { prisma } from '@qb-health/financial-model';
import { AppError } from '../middleware/error-handler';
import { AuthRequest } from '../middleware/auth';
import { paystackService } from './services/paystack.service';

const router: Router = Router();
router.get(
    '/verify',
    query('reference').isString().notEmpty().withMessage('reference is required'),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                throw new AppError(errors.array()[0].msg, 400);
            }

            const reference = req.query.reference as string;

            // 1. Verify transaction directly with Paystack
            const resp = await fetch(
                `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
                { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
            );

            if (!resp.ok) {
                throw new AppError('Paystack verification request failed', 502);
            }

            const json: any = await resp.json();

            if (!json.status || json.status !== true) {
                throw new AppError(json.message || 'Paystack verification failed', 400);
            }

            const data = json.data;

            // 2. Check if the payment was actually successful
            if (data.status !== 'success') {
                return res.json({
                    success: false,
                    status: data.status,
                    message: 'Payment was not successful'
                });
            }

            // 3. Extract connectionId from metadata
            const metadata = typeof data.metadata === 'string'
                ? JSON.parse(data.metadata)
                : (data.metadata || {});

            const connectionId = metadata.connectionId;

            if (!connectionId) {
                throw new AppError('Missing connectionId in transaction metadata', 400);
            }

            // 4. Idempotent activation (Safe even if the webhook already fired)
            await prisma.qbConnection.update({
                where: { id: connectionId },
                data: {
                    subscriptionStatus: 'ACTIVE',
                    paystackCustCode: data.customer?.customer_code || undefined,
                    lastTransactionRef: data.reference,
                },
            });

            return res.json({ success: true, status: data.status, connectionId });

        } catch (error) {

            return next(error);
        }
    }
);
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
            let planPrice = 0;
            if (planCode === 'PLN_DEFAULT') planPrice = 5000;

            const checkoutData = await paystackService.initializeTransaction(
                email,
                planPrice,
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

router.get(
    '/mock-activate',
    query('connectionId').isString().notEmpty(),
    query('planCode').optional().isString(),
    async (req: AuthRequest, res: Response, next) => {
        try {
            const isProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'prod';
            if (isProd || process.env.MOCK_BILLING !== 'true') {
                throw new AppError('Not found', 404);
            }

            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                throw new AppError('connectionId query param is required', 400);
            }

            const connectionId = req.query.connectionId as string;
            const planCode = (req.query.planCode as string) || 'PLN_44437ae17tzxlk5';

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