import { Router, Request, Response } from 'express';
import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';
import { verifyPaystackSignature } from '../../middleware/paystackWebhook';

const router: Router = Router();

router.post('/', verifyPaystackSignature, async (req: Request, res: Response) => {
    // Acknowledge receipt to Paystack immediately to prevent timeouts/retries
    res.status(200).send('OK');

    try {
        // Safely parse payload whether req.body is a Buffer, string, or already parsed object
        const payload = typeof req.body === 'string'
            ? JSON.parse(req.body)
            : Buffer.isBuffer(req.body)
                ? JSON.parse(req.body.toString('utf-8'))
                : req.body;

        const { event, data } = payload;

        if (!event || !data) {
            logger.warn('Paystack webhook received malformed payload structure');
            return;
        }

        logger.info(`Processing Paystack webhook event: ${event}`);

        switch (event) {
            case 'charge.success': {
                const connectionId = data.metadata?.connectionId;
                if (connectionId) {
                    await prisma.qbConnection.update({
                        where: { id: connectionId },
                        data: {
                            paystackCustCode: data.customer?.customer_code,
                            lastTransactionRef: data.reference,
                        }
                    });
                }
                break;
            }

            case 'subscription.create': {
                const customerCode = data.customer?.customer_code;
                if (customerCode) {
                    await prisma.qbConnection.updateMany({
                        where: { paystackCustCode: customerCode },
                        data: {
                            subscriptionStatus: 'ACTIVE',
                            paystackSubscriptionCode: data.subscription_code,
                            paystackPlanCode: data.plan?.plan_code,
                            currentPeriodEnd: data.next_payment_date ? new Date(data.next_payment_date) : null,
                        }
                    });
                }
                break;
            }

            case 'subscription.disable': {
                const subscriptionCode = data.subscription_code;
                if (subscriptionCode) {
                    await prisma.qbConnection.updateMany({
                        where: { paystackSubscriptionCode: subscriptionCode },
                        data: {
                            subscriptionStatus: 'INACTIVE'
                        }
                    });
                }
                break;
            }

            default:
                logger.info(`Unhandled Paystack webhook event type: ${event}`);
        }
    } catch (error) {
        logger.error('Error processing Paystack webhook background task:', error);
    }
});

export default router;