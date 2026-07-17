// apps/api/src/routes/webhooks.ts
import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import { prisma } from '@qb-health/financial-model';
import crypto from 'crypto';

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
    const secret = process.env.PAYSTACK_TEST_SECRET_KEY;

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
    const realmId: string | undefined = metadata.realmId;
    const packageBought: string | undefined = metadata.packageBought;

    const paystackCustCode: string = data.customer?.customer_code || '';
    const paystackPlanCode: string = data.plan?.plan_code || '';
    const transactionRef: string = data.reference || '';

    let creditsToAdd = 0;
    if (packageBought === '10_scans') {
        creditsToAdd = 10;
    } else if (!packageBought && eventType === 'charge.success') {
        creditsToAdd = 10;
    }

    let existingConnection = null;

    if (connectionId) {
        existingConnection = await prisma.qbConnection.findUnique({ where: { id: connectionId } });
    } else if (realmId) {
        existingConnection = await prisma.qbConnection.findUnique({ where: { realmId } });
    } else if (paystackCustCode) {
        existingConnection = await prisma.qbConnection.findFirst({ where: { paystackCustCode } });
    }

    if (!existingConnection) {
        console.error(`Paystack webhook: QbConnection not found. connectionId: ${connectionId}, paystackCustCode: ${paystackCustCode}`);
        return;
    }

    if (transactionRef && existingConnection.lastTransactionRef === transactionRef) {
        console.log(`Paystack webhook: Transaction ${transactionRef} already processed — skipping to prevent double credits.`);
        return;
    }

    const updateData: any = {
        subscriptionStatus: 'ACTIVE',
        paystackCustCode: paystackCustCode || undefined,
        paystackPlanCode: paystackPlanCode || undefined,
        lastTransactionRef: transactionRef
    };

    if (creditsToAdd > 0) {
        updateData.scanCredits = { increment: creditsToAdd };
    }

    await prisma.qbConnection.update({
        where: { id: existingConnection.id },
        data: updateData
    });

    console.log(`Paystack webhook: Added ${creditsToAdd} credits for connectionId: ${existingConnection.id} via ${eventType}`);
}


async function handleSubscriptionUpdate(data: any): Promise<void> {
    const metadata = parseMetadata(data.metadata);
    const paystackStatus: string = data.status;
    const paystackCustCode: string = data.customer?.customer_code || '';

    let existingConnection = null;

    if (metadata.connectionId) {
        existingConnection = await prisma.qbConnection.findUnique({ where: { id: metadata.connectionId } });
    } else if (paystackCustCode) {
        existingConnection = await prisma.qbConnection.findFirst({ where: { paystackCustCode } });
    }

    if (!existingConnection) {
        console.warn(`Paystack webhook: subscription.update failed. Could not find connection via metadata or customer code: ${paystackCustCode}`);
        return;
    }

    let subscriptionStatus: 'ACTIVE' | 'INACTIVE' | 'PAST_DUE';
    if (paystackStatus === 'active') {
        subscriptionStatus = 'ACTIVE';
    } else if (paystackStatus === 'past_due') {
        subscriptionStatus = 'PAST_DUE';
    } else {
        subscriptionStatus = 'INACTIVE';
    }

    await prisma.qbConnection.update({
        where: { id: existingConnection.id },
        data: { subscriptionStatus }
    });

    console.log(`Paystack webhook: subscription.update → ${subscriptionStatus} for connectionId: ${existingConnection.id}`);
}

export default router;