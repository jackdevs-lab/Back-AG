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

        // Retrieve raw buffer parsed by express.raw()
        const payload = Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
        const hash = crypto.createHmac('sha512', secret).update(payload).digest('hex');

        if (hash !== req.headers['x-paystack-signature']) {
            logger.warn('Invalid Paystack webhook signature detected');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        return next();
    } catch (error) {
        logger.error('Error verifying Paystack signature:', error);
        return res.status(500).json({ error: 'Internal signature verification error' });
    }
};