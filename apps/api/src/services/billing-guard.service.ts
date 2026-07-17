// apps/api/src/services/billing-guard.service.ts
import { prisma } from '@qb-health/financial-model';

export class BillingGuardService {
    async getCredits(connectionId: string): Promise<number> {
        const connection = await prisma.qbConnection.findUnique({
            where: { id: connectionId },
            select: { scanCredits: true }
        });

        return connection?.scanCredits ?? 0;
    }
}