// apps/api/src/routes/webhooks.ts
import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { prisma } from '@qb-health/financial-model';
import crypto from 'crypto';
import { Prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';

const router: Router = Router();

router.post('/clerk', async (req: Request, res: Response) => {
    const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
    if (!WEBHOOK_SECRET) {
        console.error('CLERK_WEBHOOK_SECRET is not defined');
        return res.status(500).json({ success: false, message: 'Server configuration error' });
    }

    const headers = req.headers;
    const payload = JSON.stringify(req.body);
    const svix_id = headers["svix-id"] as string;
    const svix_timestamp = headers["svix-timestamp"] as string;
    const svix_signature = headers["svix-signature"] as string;

    if (!svix_id || !svix_timestamp || !svix_signature) {
        return res.status(400).json({ success: false, message: 'Missing svix headers' });
    }

    const wh = new Webhook(WEBHOOK_SECRET);
    let evt: any;
    try {
        evt = wh.verify(payload, {
            "svix-id": svix_id,
            "svix-timestamp": svix_timestamp,
            "svix-signature": svix_signature,
        });
    } catch (err) {
        console.error('Webhook verification failed:', (err as Error).message);
        return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    const { type, data } = evt;

    try {
        if (type === 'user.created') {
            const { id, email_addresses, first_name, last_name } = data;
            const email = email_addresses[0]?.email_address;
            const name = `${first_name || ''} ${last_name || ''}`.trim() || 'New User';

            await prisma.tenant.upsert({
                where: { id },
                update: { email, name },
                create: { id, email, name }
            });

            console.log(`Synced Tenant for User: ${id}`);
        }

        if (type === 'organization.created') {
            const { id, name } = data;

            await prisma.tenant.upsert({
                where: { id },
                update: { name },
                create: {
                    id,
                    name,
                    email: `org_${id}@clerk.system`
                }
            });

            console.log(`Synced Tenant for Organization: ${id}`);
        }

        return res.status(200).json({ success: true });
    } catch (dbError) {
        console.error('Database synchronization failed:', dbError);
        return res.status(500).json({ success: false, message: 'Database sync error' });
    }
});

// Add ": Promise<any>" to the function signature
router.post('/paystack', async (req: Request, res: Response): Promise<any> => {
    const secret = process.env.PAYSTACK_TEST_SECRET_KEY; // Consider using LIVE key for production webhook URL
    if (!secret) {
        console.error('PAYSTACK_TEST_SECRET_KEY is not defined');
        return res.status(200).json({ success: false, message: 'Server configuration error' });
    }

    const rawBody = JSON.stringify(req.body);
    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
        console.error('Paystack webhook: signature verification failed');
        return res.status(400).json({ success: false, message: 'Invalid signature' });
    }

    const event = req.body;
    const eventType: string = event.event;

    console.log(`Paystack webhook received: ${eventType}`);

    // Send response to Paystack immediately so they don't timeout
    res.status(200).json({ success: true });

    // Continue processing in the background
    try {
        if (eventType === 'charge.success' || eventType === 'subscription.create') {
            await handleSubscriptionActivation(event.data, eventType);
        } else if (eventType === 'subscription.update') {
            await handleSubscriptionUpdate(event.data);
        }
        // Handle other relevant Paystack events like subscription.disable, invoice.payment_failed etc. if needed
        else if (eventType === 'subscription.disable') { // Explicitly handle disable event
            await handleSubscriptionDisable(event.data);
        }
    } catch (err) {
        console.error(`Paystack webhook: DB update failed for event ${eventType}:`, err);
    }
});

function parseMetadata(rawMetadata: any) {
    if (!rawMetadata) return {};
    if (typeof rawMetadata === 'string') {
        try {
            return JSON.parse(rawMetadata);
        } catch (e) {
            console.error('Paystack webhook: Failed to parse stringified metadata', e);
            return {};
        }
    }
    return rawMetadata;
}

async function handleSubscriptionActivation(data: any, eventType: string): Promise<void> {
    const metadata = parseMetadata(data.metadata);
    const connectionId: string | undefined = metadata.connectionId;

    const packageBought: string | undefined = metadata.packageBought; // Potentially unused now
    const paystackCustCode: string = data.customer?.customer_code || '';
    const paystackPlanCode: string = data.plan?.plan_code || '';
    const transactionRef: string = data.reference || '';



    let existingConnection = null;
    if (connectionId) {
        existingConnection = await prisma.qbConnection.findUnique({ where: { id: connectionId } });
    }


    if (!existingConnection) {
        console.error(`Paystack webhook: QbConnection not found. connectionId: ${connectionId}, paystackCustCode: ${paystackCustCode}`);
        return;
    }

    if (transactionRef && existingConnection.lastTransactionRef === transactionRef) {
        console.log(`Paystack webhook: Transaction ${transactionRef} already processed for connectionId: ${existingConnection.id} — skipping.`);
        return;
    }

    const updateData: any = {
        subscriptionStatus: 'ACTIVE', // Set to ACTIVE upon successful charge or subscription creation
        paystackCustCode: paystackCustCode || undefined,
        paystackPlanCode: paystackPlanCode || undefined,
        lastTransactionRef: transactionRef

    };

    if (data.next_payment_date) {
        updateData.currentPeriodEnd = new Date(data.next_payment_date);
    }


    await prisma.qbConnection.update({
        where: { id: existingConnection.id },
        data: updateData
    });

    console.log(`Paystack webhook: Activated subscription (status=ACTIVE) for connectionId: ${existingConnection.id} via ${eventType}`);
}


async function handleSubscriptionUpdate(data: any): Promise<void> {
    const metadata = parseMetadata(data.metadata);
    const paystackStatus: string = data.status; // 'active', 'cancelled', 'suspended', 'past_due'
    const paystackCustCode: string = data.customer?.customer_code || ''; // Fallback identifier
    const paystackSubscriptionCode: string = data.subscription_code; // Another potential identifier

    let existingConnection = null;
    if (metadata.connectionId) {
        existingConnection = await prisma.qbConnection.findUnique({ where: { id: metadata.connectionId } });
    }
    else if (paystackCustCode) {
        existingConnection = await prisma.qbConnection.findFirst({ where: { paystackCustCode } });
    } else if (paystackSubscriptionCode) {
        existingConnection = await prisma.qbConnection.findFirst({ where: { paystackSubscriptionCode } });
    }

    if (!existingConnection) {
        console.warn(`Paystack webhook: subscription.update failed. Could not find connection via metadata (${metadata.connectionId}), customer code (${paystackCustCode}), or subscription code (${paystackSubscriptionCode})`);
        return;
    }

    let subscriptionStatus: 'ACTIVE' | 'INACTIVE' | 'PAST_DUE';
    if (paystackStatus === 'active') {
        subscriptionStatus = 'ACTIVE';
    } else if (paystackStatus === 'past_due') {
        subscriptionStatus = 'PAST_DUE'; // Or another specific status if needed
    } else { // Covers 'cancelled', 'suspended', 'failed', etc.
        subscriptionStatus = 'INACTIVE'; // Generic inactive state for non-active/cancelled states
    }

    await prisma.qbConnection.update({
        where: { id: existingConnection.id },
        data: { subscriptionStatus }
    });

    console.log(`Paystack webhook: Updated subscription status to '${subscriptionStatus}' for connectionId: ${existingConnection.id} via subscription.update`);
}

async function handleSubscriptionDisable(data: any): Promise<void> {
    const metadata = parseMetadata(data.metadata);
    const paystackSubscriptionCode: string = data.subscription_code;
    const paystackCustCode: string = data.customer?.customer_code || '';

    let existingConnection = null;
    if (metadata.connectionId) {
        existingConnection = await prisma.qbConnection.findUnique({ where: { id: metadata.connectionId } });
    }
    else if (paystackSubscriptionCode) {
        existingConnection = await prisma.qbConnection.findFirst({ where: { paystackSubscriptionCode } });
    } else if (paystackCustCode) {
        existingConnection = await prisma.qbConnection.findFirst({ where: { paystackCustCode } });
    }

    if (!existingConnection) {
        console.warn(`Paystack webhook: subscription.disable failed. Could not find connection via metadata (${metadata.connectionId}), subscription code (${paystackSubscriptionCode}), or customer code (${paystackCustCode})`);
        return;
    }

    // Explicitly set status to INACTIVE upon disable event
    await prisma.qbConnection.update({
        where: { id: existingConnection.id },
        data: { subscriptionStatus: 'INACTIVE' }
    });

    console.log(`Paystack webhook: Disabled subscription (status=INACTIVE) for connectionId: ${existingConnection.id} via subscription.disable`);
}
// Inside apps/api/src/routes/webhooks.ts

router.post('/intuit', async (req: Request, res: Response) => {
    try {
        const signature = req.headers['intuit-signature'] as string;

        // Fix: Convert the raw Buffer to a UTF-8 string properly
        const payload = req.body instanceof Buffer ? req.body.toString('utf-8') : JSON.stringify(req.body);

        const intuitVerifierToken = process.env.INTUIT_WEBHOOK_TOKEN;
        if (!intuitVerifierToken) {
            logger.error('INTUIT_WEBHOOK_TOKEN is missing from environment variables');
            return res.status(500).send('Configuration Error');
        }

        const hash = crypto
            .createHmac('sha256', intuitVerifierToken)
            .update(payload)
            .digest('base64');

        if (signature !== hash) {
            logger.warn('Intuit Webhook Signature Mismatch', { expected: hash, received: signature });
            return res.status(401).send('Forbidden');
        }

        const eventData = JSON.parse(payload); // Now parses correctly

        if (eventData.eventNotifications && Array.isArray(eventData.eventNotifications)) {
            for (const notification of eventData.eventNotifications) {
                const realmId = notification.realmId;

                if (notification.dataChangeEvent && notification.dataChangeEvent.entities) {
                    const isDisconnect = notification.dataChangeEvent.entities.some(
                        (entity: any) => entity.name === 'Entitlements' && entity.operation === 'Delete'
                    );

                    if (isDisconnect) {
                        logger.info(`Intuit Webhook received disconnect event for realmId: ${realmId}`);

                        const deleted = await prisma.qbConnection.deleteMany({
                            where: { realmId: realmId }
                        });

                        logger.info(`Cleaned up DB for external disconnect. Rows affected: ${deleted.count}`);
                    }
                }
            }
        }

        return res.status(200).send('OK');
    } catch (error) {
        logger.error('Error processing Intuit Webhook', error);
        return res.status(500).send('Internal Server Error');
    }
});

export default router;
