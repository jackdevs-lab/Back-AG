// apps/api/src/services/billing-guard.service.ts
import { prisma } from '@qb-health/financial-model'; // Adjust import path as needed

export class BillingGuardService {

    async isSubscriptionActive(connectionId: string): Promise<boolean> {
        if (!connectionId) return false;

        const connection = await prisma.qbConnection.findUnique({
            where: { id: connectionId },
            select: { subscriptionStatus: true }
        });

        return connection?.subscriptionStatus === 'ACTIVE';
    }
    async getCredits(connectionId: string): Promise<number> {
        const active = await this.isSubscriptionActive(connectionId);
        return active ? 9999 : 0;
    }
}

export const billingGuard = new BillingGuardService();