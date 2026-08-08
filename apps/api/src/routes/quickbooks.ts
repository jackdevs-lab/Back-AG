import { Request, Response } from 'express';
import { prisma } from '@qb-health/financial-model';

export const disconnectCallback = async (req: Request, res: Response) => {
    // 1. Log the incoming request to verify Intuit is hitting your backend
    console.log('External disconnect browser redirect triggered', {
        rawQuery: req.query
    });

    const realmId = req.query.realmId as string;

    if (realmId) {
        try {
            // 2. Immediate Server-Side Sweep: Purge orphans and the connection
            const tables = [
                prisma.ruleFinding,
                prisma.account,
                prisma.transaction,
                prisma.customer,
                prisma.vendor,
                prisma.bankTransaction,
                prisma.reconciliation,
                prisma.ruleConfig
            ];

            await prisma.$transaction([
                // Delete child records first to avoid foreign key constraints
                ...tables.map(table => (table as any).deleteMany({ where: { realmId } })),
                prisma.qbConnection.deleteMany({ where: { realmId } })
            ]);

            console.log(`Cleaned up external disconnect and purged all orphaned records for realmId: ${realmId}`);
        } catch (error) {
            console.error(`Failed database cleanup during external disconnect for realmId: ${realmId}`, error);
        }
    } else {
        console.warn('Disconnect callback hit, but no realmId was found in the URL query parameters.');
    }

    // 3. Redirect the user back to the Next.js frontend
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${baseUrl}/disconnected`);
};