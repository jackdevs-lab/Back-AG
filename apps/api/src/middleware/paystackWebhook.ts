// middleware/paystackWebhook.ts
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '@qb-health/utils';

export const verifyPaystackSignature = (req: Request, res: Response, next: NextFunction) => {
    try {
        const secret = process.env.PAYSTACK_WEBHOOK_SECRET;
        if (!secret) {
            logger.error('PAYSTACK_WEBHOOK_SECRET is missing from environment variables');
            return res.status(500).json({ error: 'Webhook secret not configured' });
        }

        const signatureHeader = req.headers['x-paystack-signature'];
        if (!signatureHeader || typeof signatureHeader !== 'string') {
            logger.warn('Missing Paystack signature header');
            return res.status(401).json({ error: 'Missing signature' });
        }

        const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
        if (!rawBody.length) {
            logger.warn('Empty request body for Paystack webhook');
            return res.status(400).json({ error: 'Empty body' });
        }

        const computedDigest = crypto
            .createHmac('sha512', secret)
            .update(rawBody)
            .digest();

        const receivedDigest = Buffer.from(signatureHeader, 'hex');

        const isValid =
            computedDigest.length === receivedDigest.length &&
            crypto.timingSafeEqual(computedDigest, receivedDigest);

        if (!isValid) {
            logger.warn('Invalid Paystack webhook signature detected');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        return next();
    } catch (error) {
        logger.error('Error verifying Paystack signature:', error);
        return res.status(500).json({ error: 'Internal signature verification error' });
    }
};