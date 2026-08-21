import axios from 'axios';
import { encrypt, decrypt, logger } from '@qb-health/utils';
import { prisma } from '@qb-health/financial-model';

export interface QbTokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
    realmId?: string;
}

export class OAuthService {
    private refreshPromises: Map<string, Promise<string>> = new Map();

    private get clientId(): string {
        const id = process.env.QB_CLIENT_ID;
        if (!id) throw new Error('QB_CLIENT_ID environment variable is missing');
        return id;
    }

    private get clientSecret(): string {
        const secret = process.env.QB_CLIENT_SECRET;
        if (!secret) throw new Error('QB_CLIENT_SECRET environment variable is missing');
        return secret;
    }

    private get redirectUri(): string {
        const uri = process.env.QB_REDIRECT_URI;
        if (!uri) throw new Error('QB_REDIRECT_URI environment variable is missing');
        return uri;
    }

    private get isProduction(): boolean {
        return process.env.QB_ENVIRONMENT?.toLowerCase() === 'production';
    }

    getAuthUrl(state: string): string {
        const baseUrl = 'https://appcenter.intuit.com/connect/oauth2';

        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'code',
            scope: 'com.intuit.quickbooks.accounting openid profile email',
            state: state
        });

        return `${baseUrl}?${params.toString()}`;
    }

    async exchangeCodeForToken(code: string, realmIdFromCallback?: string): Promise<QbTokenResponse> {
        const response = await axios.post(
            'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: this.redirectUri
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
                }
            }
        );

        return {
            ...response.data,
            realmId: realmIdFromCallback || response.data.realmId
        };
    }

    async refreshAccessToken(refreshToken: string): Promise<QbTokenResponse> {
        const response = await axios.post(
            'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
            new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
                }
            }
        );

        return response.data;
    }

    async saveConnection(tenantId: string, realmId: string, tokenData: QbTokenResponse): Promise<void> {
        const encryptedAccessToken = encrypt(tokenData.access_token);
        const encryptedRefreshToken = encrypt(tokenData.refresh_token);
        const tokenExpiry = new Date(Date.now() + (tokenData.expires_in * 1000));

        const isDemoSandbox = realmId === process.env.INTUIT_DEMO_REALM_ID;
        const defaultSubscriptionStatus = 'ACTIVE';

        logger.info('Saving QuickBooks connection...', { tenantId, realmId, isDemoSandbox });

        try {
            await prisma.qbConnection.upsert({
                where: {
                    tenantId_realmId: { tenantId, realmId }
                },
                update: {
                    accessToken: encryptedAccessToken,
                    refreshToken: encryptedRefreshToken,
                    tokenExpiry,
                    isActive: true,
                },
                create: {
                    tenantId,
                    realmId,
                    accessToken: encryptedAccessToken,
                    refreshToken: encryptedRefreshToken,
                    tokenExpiry,
                    isActive: true,
                    syncStatus: 'IDLE',
                    subscriptionStatus: defaultSubscriptionStatus
                }
            });
        } catch (error) {
            logger.error('Failed to save connection to database', {
                tenantId,
                realmId,
                error: error instanceof Error ? error.message : error
            });
            throw error;
        }

        logger.info('QuickBooks connection saved', { tenantId, realmId });
    }

    async getConnection(realmId: string, tenantId: string) {
        const connection = await prisma.qbConnection.findUnique({
            where: {
                tenantId_realmId: {
                    tenantId,
                    realmId
                }
            }
        });

        if (!connection) {
            throw new Error(`No connection found for realm ${realmId}`);
        }

        return {
            ...connection,
            accessToken: decrypt(connection.accessToken),
            refreshToken: decrypt(connection.refreshToken)
        };
    }

    async refreshIfNeeded(realmId: string, tenantId: string): Promise<string> {
        const connection = await this.getConnection(realmId, tenantId);
        const now = new Date();
        const expiry = new Date(connection.tokenExpiry);
        const threshold = new Date(now.getTime() + 5 * 60 * 1000);

        if (expiry >= threshold) {
            return connection.accessToken;
        }

        const lockKey = `${tenantId}:${realmId}`;

        if (this.refreshPromises.has(lockKey)) {
            logger.info('Awaiting existing in-flight token refresh...', { realmId });
            return await this.refreshPromises.get(lockKey)!;
        }

        const refreshPromise = (async () => {
            try {
                logger.info('Refreshing QuickBooks token', { realmId });
                const newTokenData = await this.refreshAccessToken(connection.refreshToken);
                await this.saveConnection(tenantId, realmId, newTokenData);
                return newTokenData.access_token;
            } finally {
                this.refreshPromises.delete(lockKey);
            }
        })();

        this.refreshPromises.set(lockKey, refreshPromise);
        return await refreshPromise;
    }
}

export const oauthService = new OAuthService();