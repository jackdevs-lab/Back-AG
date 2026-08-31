//apps/api/src/routes/webhooks/paystack.ts
import { Router, Request, Response, raw } from 'express';
import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';
import { verifyPaystackSignature } from '../../middleware/paystackWebhook';

const router: Router = Router();

router.use(raw({ type: 'application/json' }));

router.post('/', verifyPaystackSignature, async (req: Request, res: Response) => {
    // 1. Acknowledge receipt immediately to avoid payment gateway timeouts
    res.status(200).send('OK');

    try {
        const payload = JSON.parse(req.body.toString('utf-8'));
        const { event: eventType, data } = payload;

        if (!eventType || !data) {
            logger.warn('Paystack webhook received malformed payload structure');
            return;
        }

        // Construct a unique deterministic event ID from Paystack payload
        const eventId = payload.id
            ? String(payload.id)
            : `${eventType}_${data.reference || data.subscription_code || Date.now()}`;

        logger.info(`Processing Paystack webhook event: ${eventType}`, {
            eventId,
            reference: data.reference,
            subscription_code: data.subscription_code,
        });

        // 2. Idempotency Gatekeeper: Reserve the event ID in PostgreSQL
        const isNewEvent = await recordWebhookEvent(eventId, eventType);
        if (!isNewEvent) {
            // Already processed by another concurrent thread or previous delivery attempt
            return;
        }

        // 3. Delegate to event handlers
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

/**
 * Attempts to record the webhook event ID. Returns false if event already exists (P2002 constraint).
 */
async function recordWebhookEvent(eventId: string, eventType: string): Promise<boolean> {
    try {
        await prisma.processedWebhook.create({
            data: {
                id: eventId,
                eventType: eventType,
            },
        });
        return true;
    } catch (error: any) {
        if (error.code === 'P2002') {
            logger.info(`Duplicate webhook event [${eventId}] intercepted by idempotency check. Skipping.`);
            return false;
        }
        throw error;
    }
}

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

    await prisma.$transaction(async (tx) => {
        const connection = await tx.qbConnection.findUnique({
            where: { id: connectionId },
            select: { id: true, lastTransactionRef: true },
        });

        if (!connection) {
            logger.warn(`charge.success: connection not found for connectionId=${connectionId}`);
            return;
        }

        if (connection.lastTransactionRef === transactionRef) {
            logger.info(`Transaction ${transactionRef} already processed for connectionId=${connectionId}, skipping.`);
            return;
        }

        await tx.qbConnection.update({
            where: {
                id: connectionId,
            },
            data: {
                subscriptionStatus: 'ACTIVE',
                paystackCustCode: customerCode || undefined,
                lastTransactionRef: transactionRef,
            },
        });
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

    await prisma.$transaction(async (tx) => {
        let connection;
        if (connectionId) {
            connection = await tx.qbConnection.findUnique({ where: { id: connectionId } });
        } else {
            connection = await tx.qbConnection.findFirst({ where: { paystackCustCode: customerCode } });
        }

        if (!connection) {
            logger.warn(`subscription.create: connection not found for connectionId=${connectionId}, customerCode=${customerCode}`);
            return;
        }

        if (connection.paystackSubscriptionCode === subscriptionCode && connection.subscriptionStatus === 'ACTIVE') {
            logger.info(`Subscription ${subscriptionCode} already active for connectionId=${connection.id}, skipping.`);
            return;
        }

        await tx.qbConnection.update({
            where: {
                id: connection.id,
            },
            data: {
                paystackCustCode: customerCode || undefined,
                paystackPlanCode: planCode || undefined,
                paystackSubscriptionCode: subscriptionCode || undefined,
                currentPeriodEnd: nextPaymentDate ? new Date(nextPaymentDate) : null,
            },
        });
    });

    logger.info(`Activated subscription (ACTIVE) via subscription.create`);
}

async function handleSubscriptionUpdate(data: any) {
    const metadata = parseMetadata(data.metadata);
    const status = data.status;
    const subscriptionCode = data.subscription_code;
    const customerCode = data.customer?.customer_code;
    const connectionId = metadata.connectionId;

    let subscriptionStatus: 'ACTIVE' | 'INACTIVE' | 'PAST_DUE';
    if (status === 'active') subscriptionStatus = 'ACTIVE';
    else if (status === 'past_due') subscriptionStatus = 'PAST_DUE';
    else subscriptionStatus = 'INACTIVE';

    await prisma.$transaction(async (tx) => {
        let connection;
        if (connectionId) {
            connection = await tx.qbConnection.findUnique({ where: { id: connectionId } });
        } else if (subscriptionCode) {
            connection = await tx.qbConnection.findFirst({ where: { paystackSubscriptionCode: subscriptionCode } });
        } else if (customerCode) {
            connection = await tx.qbConnection.findFirst({ where: { paystackCustCode: customerCode } });
        }

        if (!connection) {
            logger.warn(`subscription.update: no connection found for connectionId=${connectionId}, subCode=${subscriptionCode}`);
            return;
        }

        if (connection.subscriptionStatus === subscriptionStatus) {
            logger.info(`Subscription status already ${subscriptionStatus} for connectionId=${connection.id}, skipping.`);
            return;
        }

        await tx.qbConnection.update({
            where: {
                id: connection.id, // 'id' is the @id, so it's perfectly valid
            },
            data: {
                subscriptionStatus,

            },
        });
    });

    logger.info(`Updated subscription status to ${subscriptionStatus} via subscription.update`);
}

async function handleSubscriptionDisable(data: any) {
    const metadata = parseMetadata(data.metadata);
    const subscriptionCode = data.subscription_code;
    const customerCode = data.customer?.customer_code;
    const connectionId = metadata.connectionId;

    await prisma.$transaction(async (tx) => {
        let connection;
        if (connectionId) {
            connection = await tx.qbConnection.findUnique({ where: { id: connectionId } });
        } else if (subscriptionCode) {
            connection = await tx.qbConnection.findFirst({ where: { paystackSubscriptionCode: subscriptionCode } });
        } else if (customerCode) {
            connection = await tx.qbConnection.findFirst({ where: { paystackCustCode: customerCode } });
        }

        if (!connection) {
            logger.warn(`subscription.disable: no connection found for connectionId=${connectionId}, subCode=${subscriptionCode}`);
            return;
        }

        if (connection.subscriptionStatus === 'INACTIVE') {
            logger.info(`Subscription already INACTIVE for connectionId=${connection.id}, skipping.`);
            return;
        }

        await tx.qbConnection.update({
            where: {
                id: connection.id, // 'id' is the @id, so it's perfectly valid
            },
            data: {
                subscriptionStatus: 'INACTIVE',
            },
        });
    });

    logger.info(`Disabled subscription (INACTIVE) via subscription.disable`);
}

export default router;