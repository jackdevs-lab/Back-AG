export interface QbTokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    x_refresh_token_expires_in: number;
    realmId: string;
}
export declare class OAuthService {
    private readonly clientId;
    private readonly clientSecret;
    private readonly redirectUri;
    private readonly environment;
    constructor();
    getAuthUrl(state: string): string;
    exchangeCodeForToken(code: string): Promise<QbTokenResponse>;
    refreshAccessToken(refreshToken: string): Promise<QbTokenResponse>;
    saveConnection(tenantId: string, realmId: string, tokenData: QbTokenResponse): Promise<void>;
    getConnection(realmId: string): Promise<{
        accessToken: string;
        refreshToken: string;
        tenantId: string;
        realmId: string;
        id: string;
        updatedAt: Date;
        createdAt: Date;
        companyName: string | null;
        tokenExpiry: Date;
        isActive: boolean;
        syncStatus: string;
        lastSyncAt: Date | null;
    }>;
    refreshIfNeeded(realmId: string): Promise<string>;
}
export declare const oauthService: OAuthService;
