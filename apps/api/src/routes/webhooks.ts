// apps/api/src/routes/webhooks.ts
import { Router, Request, Response } from 'express';
import { Webhook } from 'svix';
import express from 'express';
import { prisma } from '@qb-health/financial-model';
import crypto from 'crypto';
import { logger } from '@qb-health/utils';

const router: Router = Router();

router.post(
    '/clerk',
    express.raw({ type: 'application/json' }),
    async (req: Request, res: Response) => {
        const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;
        if (!WEBHOOK_SECRET) {
            logger.error('CLERK_WEBHOOK_SECRET is not defined');
            return res.status(500).json({ success: false, message: 'Server configuration error' });
        }

        const headers = req.headers;
        const payload = req.body.toString('utf-8'); // raw string
        const svix_id = headers['svix-id'] as string;
        const svix_timestamp = headers['svix-timestamp'] as string;
        const svix_signature = headers['svix-signature'] as string;

        if (!svix_id || !svix_timestamp || !svix_signature) {
            return res.status(400).json({ success: false, message: 'Missing svix headers' });
        }

        const wh = new Webhook(WEBHOOK_SECRET);
        let evt: any;
        try {
            evt = wh.verify(payload, {
                'svix-id': svix_id,
                'svix-timestamp': svix_timestamp,
                'svix-signature': svix_signature,
            });
        } catch (err) {
            logger.error('Webhook verification failed:', (err as Error).message);
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
                    create: { id, email, name },
                });

                logger.info(`Synced Tenant for User: ${id}`);
            }

            if (type === 'organization.created') {
                const { id, name } = data;

                await prisma.tenant.upsert({
                    where: { id },
                    update: { name },
                    create: {
                        id,
                        name,
                        email: `org_${id}@clerk.system`,
                    },
                });

                logger.info(`Synced Tenant for Organization: ${id}`);
            }

            return res.status(200).json({ success: true });
        } catch (dbError) {
            logger.error('Database synchronization failed:', dbError);
            return res.status(500).json({ success: false, message: 'Database sync error' });
        }
    }
);


router.post('/intuit', async (req: Request, res: Response) => {
    try {
        const signature = req.headers['intuit-signature'] as string;
        const payload = req.body instanceof Buffer ? req.body.toString('utf-8') : JSON.stringify(req.body);

        const intuitVerifierToken = process.env.INTUIT_WEBHOOK_TOKEN;
        if (!intuitVerifierToken) {
            logger.error('INTUIT_WEBHOOK_TOKEN is missing from environment variables');
            return res.status(500).send('Configuration Error');
        }

        if (!signature) {
            return res.status(401).send('Forbidden');
        }

        const hash = crypto
            .createHmac('sha256', intuitVerifierToken)
            .update(payload)
            .digest('base64');

        // SECURE CHANGE: Use timingSafeEqual to prevent timing attacks on signature comparison
        const signatureBuffer = Buffer.from(signature);
        const hashBuffer = Buffer.from(hash);

        if (signatureBuffer.length !== hashBuffer.length || !crypto.timingSafeEqual(signatureBuffer, hashBuffer)) {
            logger.warn('Intuit Webhook Signature Mismatch', { received: signature });
            return res.status(401).send('Forbidden');
        }

        const eventData = JSON.parse(payload);

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
