import { Request, Response } from 'express';
import { logger } from '@qb-health/utils';

export const disconnectCallback = (req: Request, res: Response) => {
    const realmId = String(req.query.realmId || '').trim();

    logger.info('QuickBooks external disconnect callback received', {
        hasRealmId: Boolean(realmId)
    });

    const frontendUrl = process.env.FRONTEND_URL;

    if (!frontendUrl) {
        logger.error('FRONTEND_URL is not configured');
        return res.status(500).send('Frontend URL is not configured');
    }

    return res.redirect(`${frontendUrl}/disconnect`);
};