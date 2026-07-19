import { Router, Request, Response } from 'express';
import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';
import { verifyPaystackSignature } from '../../middleware/paystackWebhook';

const router: Router = Router();

router.post('/', verifyPaystackSignature, async (req: Request, res: Response) => {
    res.status(200).send('OK');

    try {
        const payload = JSON.parse(req.body.toString());
        const { event, data } = payload;

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
                            // Adding scan allowance as standard behavior for active subs
                            scanCredits: 10
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
                            subscriptionStatus: 'CANCELED'
                        }
                    });
                }
                break;
            }

            default:
                logger.info(`Unhandled Paystack webhook event type: ${event}`);
        }
    } catch (error) {
        logger.error('Error processing Paystack webhook:', error);
    }
});

export default router;