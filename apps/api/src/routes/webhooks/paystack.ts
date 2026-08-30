import { Router, Request, Response, raw } from 'express';
import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';
import { verifyPaystackSignature } from '../../middleware/paystackWebhook';

const router: Router = Router();

router.use(raw({ type: 'application/json' }));

router.post('/', verifyPaystackSignature, async (req: Request, res: Response) => {
    res.status(200).send('OK');

    try {
        const payload = JSON.parse(req.body.toString('utf-8'));
        const { event: eventType, data } = payload;

        if (!eventType || !data) {
            logger.warn('Paystack webhook received malformed payload structure');
            return;
        }

        logger.info(`Processing Paystack webhook event: ${eventType}`, {
            reference: data.reference,
            subscription_code: data.subscription_code,
        });

        switch (eventType) {
            case 'charge.success':
                await handleChargeSuccess(data);
                break;
            case 'subscription.create':
                await handleSubscriptionCreate(data);
                break;
            case 'subscription.update':
                await handleSubscriptionUpdate(data);
                break;
            case 'subscription.disable':
                await handleSubscriptionDisable(data);
                break;
            default:
                logger.info(`Unhandled Paystack event type: ${eventType}`);
        }
    } catch (error) {
        logger.error('Error processing Paystack webhook background task:', error);
    }
});

function parseMetadata(metadata: any): Record<string, any> {
    if (!metadata) return {};
    if (typeof metadata === 'string') {
        try {
            return JSON.parse(metadata);
        } catch (e) {
            logger.error('Failed to parse stringified metadata', e);
            return {};
        }
    }
    return metadata;
}

async function handleChargeSuccess(data: any) {
    const metadata = parseMetadata(data.metadata);
    const connectionId: string | undefined = metadata.connectionId;
    if (!connectionId) {
        logger.warn('charge.success: missing connectionId in metadata');
        return;
    }

    const transactionRef = data.reference;
    const customerCode = data.customer?.customer_code;

    const existing = await prisma.qbConnection.findUnique({
        where: { id: connectionId },
        select: { lastTransactionRef: true },
    });

    if (existing?.lastTransactionRef === transactionRef) {
        logger.info(`Transaction ${transactionRef} already processed for connectionId=${connectionId}, skipping.`);
        return;
    }

    await prisma.qbConnection.update({
        where: { id: connectionId },
        data: {
            paystackCustCode: customerCode || undefined,
            lastTransactionRef: transactionRef,
        },
    });

    logger.info(`Updated charge.success for connectionId=${connectionId}`);
}

async function handleSubscriptionCreate(data: any) {
    const metadata = parseMetadata(data.metadata);
    const connectionId: string | undefined = metadata.connectionId;
    const customerCode = data.customer?.customer_code;
    const planCode = data.plan?.plan_code;
    const subscriptionCode = data.subscription_code;
    const nextPaymentDate = data.next_payment_date;

    if (!connectionId && !customerCode) {
        logger.warn('subscription.create: no identifier to find connection');
        return;
    }

    let connection;
    if (connectionId) {
        connection = await prisma.qbConnection.findUnique({ where: { id: connectionId } });
    } else {
        connection = await prisma.qbConnection.findFirst({ where: { paystackCustCode: customerCode } });
    }

    if (!connection) {
        logger.warn(`subscription.create: connection not found for connectionId=${connectionId}, customerCode=${customerCode}`);
        return;
    }

    if (connection.paystackSubscriptionCode === subscriptionCode && connection.subscriptionStatus === 'ACTIVE') {
        logger.info(`Subscription ${subscriptionCode} already active for connectionId=${connection.id}, skipping.`);
        return;
    }

    await prisma.qbConnection.update({
        where: { id: connection.id },
        data: {
            subscriptionStatus: 'ACTIVE',
            paystackCustCode: customerCode || undefined,
            paystackPlanCode: planCode || undefined,
            paystackSubscriptionCode: subscriptionCode || undefined,
            currentPeriodEnd: nextPaymentDate ? new Date(nextPaymentDate) : null,
        },
    });

    logger.info(`Activated subscription (ACTIVE) for connectionId=${connection.id} via subscription.create`);
}

async function handleSubscriptionUpdate(data: any) {
    const metadata = parseMetadata(data.metadata);
    const status = data.status;
    const subscriptionCode = data.subscription_code;
    const customerCode = data.customer?.customer_code;
    const connectionId = metadata.connectionId;

    let connection;
    if (connectionId) {
        connection = await prisma.qbConnection.findUnique({ where: { id: connectionId } });
    } else if (subscriptionCode) {
        connection = await prisma.qbConnection.findFirst({ where: { paystackSubscriptionCode: subscriptionCode } });
    } else if (customerCode) {
        connection = await prisma.qbConnection.findFirst({ where: { paystackCustCode: customerCode } });
    }

    if (!connection) {
        logger.warn(`subscription.update: no connection found for connectionId=${connectionId}, subCode=${subscriptionCode}, custCode=${customerCode}`);
        return;
    }

    let subscriptionStatus: 'ACTIVE' | 'INACTIVE' | 'PAST_DUE';
    if (status === 'active') subscriptionStatus = 'ACTIVE';
    else if (status === 'past_due') subscriptionStatus = 'PAST_DUE';
    else subscriptionStatus = 'INACTIVE';

    if (connection.subscriptionStatus === subscriptionStatus) {
        logger.info(`Subscription status already ${subscriptionStatus} for connectionId=${connection.id}, skipping.`);
        return;
    }

    await prisma.qbConnection.update({
        where: { id: connection.id },
        data: { subscriptionStatus },
    });

    logger.info(`Updated subscription status to ${subscriptionStatus} for connectionId=${connection.id} via subscription.update`);
}

async function handleSubscriptionDisable(data: any) {
    const metadata = parseMetadata(data.metadata);
    const subscriptionCode = data.subscription_code;
    const customerCode = data.customer?.customer_code;
    const connectionId = metadata.connectionId;

    let connection;
    if (connectionId) {
        connection = await prisma.qbConnection.findUnique({ where: { id: connectionId } });
    } else if (subscriptionCode) {
        connection = await prisma.qbConnection.findFirst({ where: { paystackSubscriptionCode: subscriptionCode } });
    } else if (customerCode) {
        connection = await prisma.qbConnection.findFirst({ where: { paystackCustCode: customerCode } });
    }

    if (!connection) {
        logger.warn(`subscription.disable: no connection found for connectionId=${connectionId}, subCode=${subscriptionCode}, custCode=${customerCode}`);
        return;
    }

    if (connection.subscriptionStatus === 'INACTIVE') {
        logger.info(`Subscription already INACTIVE for connectionId=${connection.id}, skipping.`);
        return;
    }

    await prisma.qbConnection.update({
        where: { id: connection.id },
        data: { subscriptionStatus: 'INACTIVE' },
    });

    logger.info(`Disabled subscription (INACTIVE) for connectionId=${connection.id} via subscription.disable`);
}

export default router;