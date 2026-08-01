import { Request, Response } from 'express';
import { prisma } from '@qb-health/financial-model';

export const disconnectCallback = async (req: Request, res: Response) => {
    const realmId = req.query.realmId as string;

    if (realmId) {
        try {
            await prisma.qbConnection.deleteMany({
                where: { realmId }
            });
            console.log(`Cleaned up external disconnect for realmId: ${realmId}`);
        } catch (error) {
            console.error('Failed to delete qbConnection during external disconnect:', error);
        }
    }

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${baseUrl}/disconnected`);
};