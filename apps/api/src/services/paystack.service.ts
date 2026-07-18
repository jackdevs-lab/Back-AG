import { logger } from '@qb-health/utils';
import { prisma } from '@qb-health/financial-model';

export class PaystackService {
    private static readonly BASE_URL = 'https://api.paystack.co';

    /**
     * Dynamically selects the correct secret key based on the environment.
     * Prevents accidental use of test keys in production.
     */
    private get secretKey(): string {
        const isProduction = process.env.NODE_ENV === 'production';
        const key = isProduction
            ? process.env.PAYSTACK_LIVE_SECRET_KEY
            : process.env.PAYSTACK_TEST_SECRET_KEY;

        if (!key) {
            throw new Error(`PAYSTACK_${isProduction ? 'LIVE' : 'TEST'}_SECRET_KEY is not configured`);
        }
        return key;
    }

    private get isMockBilling(): boolean {
        return process.env.NODE_ENV !== 'production' && process.env.MOCK_BILLING === 'true';
    }

    /**
     * Initializes a Paystack transaction for a recurring subscription.
     * @param planCode The Paystack Plan Code (e.g., 'PLN_xxxxx') from your Paystack Dashboard
     */
    async initializeTransaction(
        email: string,
        connectionId: string,
        realmId: string,
        clerkUserId: string,
        planCode: string
    ) {
        if (this.isMockBilling) {
            const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001/api';
            const mockActivateUrl = `${baseUrl}/subscriptions/mock-activate?connectionId=${connectionId}&planCode=${planCode}`;

            logger.warn('[MOCK_BILLING] Bypassing Paystack. Mock activate URL returned.', { connectionId });
            return {
                authorization_url: mockActivateUrl,
                access_code: 'MOCK_ACCESS_CODE',
                reference: `MOCK_REF_${Date.now()}`
            };
        }

        try {
            // Note: Including the 'plan' parameter tells Paystack to treat this as a subscription
            const response = await fetch(`${PaystackService.BASE_URL}/transaction/initialize`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.secretKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    plan: planCode,
                    metadata: {
                        connectionId,
                        realmId,
                        clerkUserId,
                        packageBought: planCode
                    }
                })
            });

            const data = await response.json() as any;

            if (!response.ok) {
                logger.error('Paystack initialization failed:', data);
                throw new Error(data.message || 'Failed to initialize transaction');
            }

            return data.data;
        } catch (error: any) {
            logger.error('Error in initializeTransaction:', error.message);
            throw error;
        }
    }

    /**
     * Mocks a successful subscription activation for local development/testing.
     * Updated to reflect the new Prisma schema fields.
     */
    async mockActivate(connectionId: string, planCode: string = 'PLN_MOCK'): Promise<void> {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('Mock activation is not available in production');
        }

        // Calculate a mock period end (e.g., 30 days from now for monthly)
        const currentPeriodEnd = new Date();
        currentPeriodEnd.setDate(currentPeriodEnd.getDate() + 30);

        await prisma.qbConnection.update({
            where: { id: connectionId },
            data: {
                subscriptionStatus: 'ACTIVE',
                paystackSubscriptionCode: 'MOCK_SUB_CODE',
                paystackPlanCode: planCode,
                billingCycle: 'MONTHLY',
                currentPeriodEnd: currentPeriodEnd,
                // Retaining scan credits logic if still applicable to your flow
                scanCredits: { increment: 10 }
            }
        });

        logger.warn(`[MOCK_BILLING] Activated mock subscription for connectionId: ${connectionId}`);
    }
}

export const paystackService = new PaystackService();