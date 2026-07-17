import { logger } from '@qb-health/utils';
import { prisma } from '@qb-health/financial-model';

export class PaystackService {
    private static readonly BASE_URL = 'https://api.paystack.co';

    private get isMockBilling(): boolean {
        return (
            process.env.NODE_ENV !== 'production' &&
            process.env.MOCK_BILLING === 'true'
        );
    }

    async initializeTransaction(
        email: string,
        connectionId: string,
        realmId: string,
        clerkUserId: string,
        packageType: string = '10_scans'
    ) {
        if (this.isMockBilling) {
            const mockActivateUrl = `${process.env.API_BASE_URL || 'http://localhost:3001'}/api/subscriptions/mock-activate?connectionId=${connectionId}&packageType=${packageType}`;
            logger.warn('[MOCK_BILLING] Bypassing Paystack. Mock activate URL returned.', { connectionId });
            return {
                authorization_url: mockActivateUrl,
                access_code: 'MOCK_ACCESS_CODE',
                reference: `MOCK_REF_${Date.now()}`
            };
        }

        const secretKey = process.env.PAYSTACK_TEST_SECRET_KEY;
        if (!secretKey) {
            throw new Error('PAYSTACK_TEST_SECRET_KEY is not configured');
        }

        let amount = 0;
        if (packageType === '10_scans') {
            amount = 2900 * 100;
        }

        try {
            const response = await fetch(`${PaystackService.BASE_URL}/transaction/initialize`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${secretKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    amount,
                    currency: 'USD',
                    metadata: {
                        connectionId,
                        realmId,
                        clerkUserId,
                        packageBought: packageType
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

    async mockActivate(connectionId: string, packageType: string = '10_scans'): Promise<void> {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('Mock activation is not available in production');
        }

        let creditsToAdd = 0;
        if (packageType === '10_scans') creditsToAdd = 10;

        await prisma.qbConnection.update({
            where: { id: connectionId },
            data: {
                scanCredits: { increment: creditsToAdd },
                subscriptionStatus: 'ACTIVE',
                paystackCustCode: 'MOCK_CUSTOMER',
                paystackPlanCode: 'MOCK_PLAN'
            }
        });

        logger.warn(`[MOCK_BILLING] Added ${creditsToAdd} credits to connectionId: ${connectionId}`);
    }
}

export const paystackService = new PaystackService();