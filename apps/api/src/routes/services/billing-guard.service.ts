// apps/api/src/services/billing-guard.service.ts
import { prisma } from '@qb-health/financial-model';

export class BillingGuardService {
    /**
     * The single source of truth for subscription access.
     */
    async isSubscriptionActive(connectionId: string): Promise<boolean> {
        if (!connectionId) return false;

        const connection = await prisma.qbConnection.findUnique({
            where: { id: connectionId },
            include: { tenant: true }
        });

        if (!connection) return false;

        // 1. Sandbox / Demo Bypass
        if (connection.isSandbox || connection.realmId === process.env.INTUIT_DEMO_REALM_ID) {
            return true;
        }

        // 2. Tenant-level Bypass (e.g., Free Trials, Internal Reviewers)
        if (connection.tenant?.isBypassed) {
            return true;
        }

        // 3. Hard Status Check
        if (connection.subscriptionStatus !== 'ACTIVE') {
            return false;
        }

        // 4. Expiry Check (Grace period logic can be added here later)
        if (connection.currentPeriodEnd && new Date(connection.currentPeriodEnd) < new Date()) {
            // Optional: Auto-downgrade to PAST_DUE here if you want
            return false;
        }

        return true;
    }

    async getCredits(connectionId: string): Promise<number> {
        const active = await this.isSubscriptionActive(connectionId);
        return active ? 9999 : 0;
    }
}

export const billingGuard = new BillingGuardService();