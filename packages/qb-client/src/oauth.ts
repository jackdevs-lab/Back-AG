import axios from 'axios';
import { encrypt, decrypt, logger } from '@qb-health/utils';
import { prisma } from '@qb-health/financial-model';

export interface QbTokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
    realmId: string;
}

export class OAuthService {
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectUri: string;
    private readonly environment: 'sandbox' | 'production';

    constructor() {
        this.clientId = process.env.QB_CLIENT_ID!;
        this.clientSecret = process.env.QB_CLIENT_SECRET!;
        this.redirectUri = process.env.QB_REDIRECT_URI!;
        this.environment = (process.env.QB_ENVIRONMENT as 'sandbox' | 'production') || 'sandbox';
    }

    getAuthUrl(state: string): string {
        const baseUrl = this.environment === 'sandbox'
            ? 'https://appcenter.intuit.com/connect/oauth2'
            : 'https://appcenter.intuit.com/connect/oauth2';

        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'code',
            scope: 'com.intuit.quickbooks.accounting',
            state: state
        });

        return `${baseUrl}?${params.toString()}`;
    }

    async exchangeCodeForToken(code: string): Promise<QbTokenResponse> {
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
            realmId: response.data.realmId || response.data.realmId
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

        logger.info('Saving QuickBooks connection...', { tenantId, realmId });

        try {
            await prisma.qbConnection.upsert({
                where: { realmId },
                update: {
                    tenantId,
                    accessToken: encryptedAccessToken,
                    refreshToken: encryptedRefreshToken,
                    tokenExpiry,
                    isActive: true
                },
                create: {
                    tenantId,
                    realmId,
                    accessToken: encryptedAccessToken,
                    refreshToken: encryptedRefreshToken,
                    tokenExpiry,
                    isActive: true,
                    syncStatus: 'IDLE'
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

    async getConnection(realmId: string) {
        const connection = await prisma.qbConnection.findUnique({
            where: { realmId }
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

    async refreshIfNeeded(realmId: string): Promise<string> {
        const connection = await this.getConnection(realmId);
        const now = new Date();
        const expiry = new Date(connection.tokenExpiry);
        const threshold = new Date(now.getTime() + 5 * 60 * 1000);

        logger.info('Token refresh check', { 
            realmId, 
            expiry: expiry.toISOString(), 
            now: now.toISOString(),
            isExpired: expiry < threshold
        });

        // Refresh if token expires within 5 minutes
        if (expiry < threshold) {
            logger.info('Refreshing QuickBooks token', { realmId });

            const newTokenData = await this.refreshAccessToken(connection.refreshToken);
            await this.saveConnection(connection.tenantId, realmId, newTokenData);

            return newTokenData.access_token;
        }

        return connection.accessToken;
    }
}

export const oauthService = new OAuthService();