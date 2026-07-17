"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.oauthService = exports.OAuthService = void 0;
const axios_1 = __importDefault(require("axios"));
const utils_1 = require("@qb-health/utils");
const financial_model_1 = require("@qb-health/financial-model");
class OAuthService {
    clientId;
    clientSecret;
    redirectUri;
    environment;
    constructor() {
        this.clientId = process.env.QB_CLIENT_ID;
        this.clientSecret = process.env.QB_CLIENT_SECRET;
        this.redirectUri = process.env.QB_REDIRECT_URI;
        this.environment = process.env.QB_ENVIRONMENT || 'sandbox';
    }
    getAuthUrl(state) {
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
    async exchangeCodeForToken(code) {
        const response = await axios_1.default.post('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.redirectUri
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
            }
        });
        return {
            ...response.data,
            realmId: response.data.realmId || response.data.realmId
        };
    }
    async refreshAccessToken(refreshToken) {
        const response = await axios_1.default.post('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        }), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
            }
        });
        return response.data;
    }
    async saveConnection(tenantId, realmId, tokenData) {
        const encryptedAccessToken = (0, utils_1.encrypt)(tokenData.access_token);
        const encryptedRefreshToken = (0, utils_1.encrypt)(tokenData.refresh_token);
        const tokenExpiry = new Date(Date.now() + (tokenData.expires_in * 1000));
        await financial_model_1.prisma.qbConnection.upsert({
            where: { realmId },
            update: {
                tenantId,
                accessToken: encryptedAccessToken,
                refreshToken: encryptedRefreshToken,
                tokenExpiry,
                isActive: true,
                syncStatus: 'IDLE'
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
        utils_1.logger.info('QuickBooks connection saved', { tenantId, realmId });
    }
    async getConnection(realmId) {
        const connection = await financial_model_1.prisma.qbConnection.findUnique({
            where: { realmId }
        });
        if (!connection) {
            throw new Error(`No connection found for realm ${realmId}`);
        }
        return {
            ...connection,
            accessToken: (0, utils_1.decrypt)(connection.accessToken),
            refreshToken: (0, utils_1.decrypt)(connection.refreshToken)
        };
    }
    async refreshIfNeeded(realmId) {
        const connection = await this.getConnection(realmId);
        const now = new Date();
        // Refresh if token expires within 5 minutes
        if (connection.tokenExpiry < new Date(now.getTime() + 5 * 60 * 1000)) {
            utils_1.logger.info('Refreshing QuickBooks token', { realmId });
            const newTokenData = await this.refreshAccessToken(connection.refreshToken);
            await this.saveConnection(connection.tenantId, realmId, newTokenData);
            return newTokenData.access_token;
        }
        return connection.accessToken;
    }
}
exports.OAuthService = OAuthService;
exports.oauthService = new OAuthService();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2F1dGguanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJvYXV0aC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxrREFBMEI7QUFDMUIsNENBQTREO0FBQzVELGdFQUFvRDtBQVVwRCxNQUFhLFlBQVk7SUFDSixRQUFRLENBQVM7SUFDakIsWUFBWSxDQUFTO0lBQ3JCLFdBQVcsQ0FBUztJQUNwQixXQUFXLENBQTJCO0lBRXZEO1FBQ0ksSUFBSSxDQUFDLFFBQVEsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLFlBQWEsQ0FBQztRQUMxQyxJQUFJLENBQUMsWUFBWSxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0JBQWlCLENBQUM7UUFDbEQsSUFBSSxDQUFDLFdBQVcsR0FBRyxPQUFPLENBQUMsR0FBRyxDQUFDLGVBQWdCLENBQUM7UUFDaEQsSUFBSSxDQUFDLFdBQVcsR0FBSSxPQUFPLENBQUMsR0FBRyxDQUFDLGNBQTJDLElBQUksU0FBUyxDQUFDO0lBQzdGLENBQUM7SUFFRCxVQUFVLENBQUMsS0FBYTtRQUNwQixNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsV0FBVyxLQUFLLFNBQVM7WUFDMUMsQ0FBQyxDQUFDLDZDQUE2QztZQUMvQyxDQUFDLENBQUMsNkNBQTZDLENBQUM7UUFFcEQsTUFBTSxNQUFNLEdBQUcsSUFBSSxlQUFlLENBQUM7WUFDL0IsU0FBUyxFQUFFLElBQUksQ0FBQyxRQUFRO1lBQ3hCLFlBQVksRUFBRSxJQUFJLENBQUMsV0FBVztZQUM5QixhQUFhLEVBQUUsTUFBTTtZQUNyQixLQUFLLEVBQUUsa0NBQWtDO1lBQ3pDLEtBQUssRUFBRSxLQUFLO1NBQ2YsQ0FBQyxDQUFDO1FBRUgsT0FBTyxHQUFHLE9BQU8sSUFBSSxNQUFNLENBQUMsUUFBUSxFQUFFLEVBQUUsQ0FBQztJQUM3QyxDQUFDO0lBRUQsS0FBSyxDQUFDLG9CQUFvQixDQUFDLElBQVk7UUFDbkMsTUFBTSxRQUFRLEdBQUcsTUFBTSxlQUFLLENBQUMs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WUFDYixXQUFXLEVBQUUsSUFBQSxlQUFPLEVBQUMsVUFBVSxDQUFDLFdBQVcsQ0FBQztZQUM1QyxZQUFZLEVBQUUsSUFBQSxlQUFPLEVBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQztTQUNqRCxDQUFDO0lBQ04sQ0FBQztJQUVELEtBQUssQ0FBQyxlQUFlLENBQUMsT0FBZTtRQUNqQyxNQUFNLFVBQVUsR0FBRyxNQUFNLElBQUksQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDckQsTUFBTSxHQUFHLEdBQUcsSUFBSSxJQUFJLEVBQUUsQ0FBQztRQUV2Qiw0Q0FBNEM7UUFDNUMsSUFBSSxVQUFVLENBQUMsV0FBVyxHQUFHLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsR0FBRyxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDbkUsY0FBTSxDQUFDLElBQUksQ0FBQyw2QkFBNkIsRUFBRSxFQUFFLE9BQU8sRUFBRSxDQUFDLENBQUM7WUFFeEQsTUFBTSxZQUFZLEdBQUcsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsVUFBVSxDQUFDLFlBQVksQ0FBQyxDQUFDO1lBQzVFLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxVQUFVLENBQUMsUUFBUSxFQUFFLE9BQU8sRUFBRSxZQUFZLENBQUMsQ0FBQztZQUV0RSxPQUFPLFlBQVksQ0FBQyxZQUFZLENBQUM7UUFDckMsQ0FBQztRQUVELE9BQU8sVUFBVSxDQUFDLFdBQVcsQ0FBQztJQUNsQyxDQUFDO0NBQ0o7QUFsSUQsb0NBa0lDO0FBRVksUUFBQSxZQUFZLEdBQUcsSUFBSSxZQUFZLEVBQUUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBheGlvcyBmcm9tICdheGlvcyc7XHJcbmltcG9ydCB7IGVuY3J5cHQsIGRlY3J5cHQsIGxvZ2dlciB9IGZyb20gJ0BxYi1oZWFsdGgvdXRpbHMnO1xyXG5pbXBvcnQgeyBwcmlzbWEgfSBmcm9tICdAcWItaGVhbHRoL2ZpbmFuY2lhbC1tb2RlbCc7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFFiVG9rZW5SZXNwb25zZSB7XHJcbiAgICBhY2Nlc3NfdG9rZW46IHN0cmluZztcclxuICAgIHJlZnJlc2hfdG9rZW46IHN0cmluZztcclxuICAgIGV4cGlyZXNfaW46IG51bWJlcjtcclxuICAgIHhfcmVmcmVzaF90b2tlbl9leHBpcmVzX2luOiBudW1iZXI7XHJcbiAgICByZWFsbUlkOiBzdHJpbmc7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBPQXV0aFNlcnZpY2Uge1xyXG4gICAgcHJpdmF0ZSByZWFkb25seSBjbGllbnRJZDogc3RyaW5nO1xyXG4gICAgcHJpdmF0ZSByZWFkb25seSBjbGllbnRTZWNyZXQ6IHN0cmluZztcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgcmVkaXJlY3RVcmk6IHN0cmluZztcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgZW52aXJvbm1lbnQ6ICdzYW5kYm94JyB8ICdwcm9kdWN0aW9uJztcclxuXHJcbiAgICBjb25zdHJ1Y3RvcigpIHtcclxuICAgICAgICB0aGlzLmNsaWVudElkID0gcHJvY2Vzcy5lbnYuUUJfQ0xJRU5UX0lEITtcclxuICAgICAgICB0aGlzLmNsaWVudFNlY3JldCA9IHByb2Nlc3MuZW52LlFCX0NMSUVOVF9TRUNSRVQhO1xyXG4gICAgICAgIHRoaXMucmVkaXJlY3RVcmkgPSBwcm9jZXNzLmVudi5RQl9SRURJUkVDVF9VUkkhO1xyXG4gICAgICAgIHRoaXMuZW52aXJvbm1lbnQgPSAocHJvY2Vzcy5lbnYuUUJfRU5WSVJPTk1FTlQgYXMgJ3NhbmRib3gnIHwgJ3Byb2R1Y3Rpb24nKSB8fCAnc2FuZGJveCc7XHJcbiAgICB9XHJcblxyXG4gICAgZ2V0QXV0aFVybChzdGF0ZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICAgICAgICBjb25zdCBiYXNlVXJsID0gdGhpcy5lbnZpcm9ubWVudCA9PT0gJ3NhbmRib3gnXHJcbiAgICAgICAgICAgID8gJ2h0dHBzOi8vYXBwY2VudGVyLmludHVpdC5jb20vY29ubmVjdC9vYXV0aDInXHJcbiAgICAgICAgICAgIDogJ2h0dHBzOi8vYXBwY2VudGVyLmludHVpdC5jb20vY29ubmVjdC9vYXV0aDInO1xyXG5cclxuICAgICAgICBjb25zdCBwYXJhbXMgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHtcclxuICAgICAgICAgICAgY2xpZW50X2lkOiB0aGlzLmNsaWVudElkLFxyXG4gICAgICAgICAgICByZWRpcmVjdF91cmk6IHRoaXMucmVkaXJlY3RVcmksXHJcbiAgICAgICAgICAgIHJlc3BvbnNlX3R5cGU6ICdjb2RlJyxcclxuICAgICAgICAgICAgc2NvcGU6ICdjb20uaW50dWl0LnF1aWNrYm9va3MuYWNjb3VudGluZycsXHJcbiAgICAgICAgICAgIHN0YXRlOiBzdGF0ZVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICByZXR1cm4gYCR7YmFzZVVybH0/JHtwYXJhbXMudG9TdHJpbmcoKX1gO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIGV4Y2hhbmdlQ29kZUZvclRva2VuKGNvZGU6IHN0cmluZyk6IFByb21pc2U8UWJUb2tlblJlc3BvbnNlPiB7XHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBheGlvcy5wb3N0KFxyXG4gICAgICAgICAgICAnaHR0cHM6Ly9vYXV0aC5wbGF0Zm9ybS5pbnR1aXQuY29tL29hdXRoMi92MS90b2tlbnMvYmVhcmVyJyxcclxuICAgICAgICAgICAgbmV3IFVSTFNlYXJjaFBhcmFtcyh7XHJcbiAgICAgICAgICAgICAgICBncmFudF90eXBlOiAnYXV0aG9yaXphdGlvbl9jb2RlJyxcclxuICAgICAgICAgICAgICAgIGNvZGUsXHJcbiAgICAgICAgICAgICAgICByZWRpcmVjdF91cmk6IHRoaXMucmVkaXJlY3RVcmlcclxuICAgICAgICAgICAgfSksXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL3gtd3d3LWZvcm0tdXJsZW5jb2RlZCcsXHJcbiAgICAgICAgICAgICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmFzaWMgJHtCdWZmZXIuZnJvbShgJHt0aGlzLmNsaWVudElkfToke3RoaXMuY2xpZW50U2VjcmV0fWApLnRvU3RyaW5nKCdiYXNlNjQnKX1gXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICApO1xyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAuLi5yZXNwb25zZS5kYXRhLFxyXG4gICAgICAgICAgICByZWFsbUlkOiByZXNwb25zZS5kYXRhLnJlYWxtSWQgfHwgcmVzcG9uc2UuZGF0YS5yZWFsbUlkXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyByZWZyZXNoQWNjZXNzVG9rZW4ocmVmcmVzaFRva2VuOiBzdHJpbmcpOiBQcm9taXNlPFFiVG9rZW5SZXNwb25zZT4ge1xyXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgYXhpb3MucG9zdChcclxuICAgICAgICAgICAgJ2h0dHBzOi8vb2F1dGgucGxhdGZvcm0uaW50dWl0LmNvbS9vYXV0aDIvdjEvdG9rZW5zL2JlYXJlcicsXHJcbiAgICAgICAgICAgIG5ldyBVUkxTZWFyY2hQYXJhbXMoe1xyXG4gICAgICAgICAgICAgICAgZ3JhbnRfdHlwZTogJ3JlZnJlc2hfdG9rZW4nLFxyXG4gICAgICAgICAgICAgICAgcmVmcmVzaF90b2tlbjogcmVmcmVzaFRva2VuXHJcbiAgICAgICAgICAgIH0pLFxyXG4gICAgICAgICAgICB7XHJcbiAgICAgICAgICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnLFxyXG4gICAgICAgICAgICAgICAgICAgICdBdXRob3JpemF0aW9uJzogYEJhc2ljICR7QnVmZmVyLmZyb20oYCR7dGhpcy5jbGllbnRJZH06JHt0aGlzLmNsaWVudFNlY3JldH1gKS50b1N0cmluZygnYmFzZTY0Jyl9YFxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgICAgcmV0dXJuIHJlc3BvbnNlLmRhdGE7XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgc2F2ZUNvbm5lY3Rpb24odGVuYW50SWQ6IHN0cmluZywgcmVhbG1JZDogc3RyaW5nLCB0b2tlbkRhdGE6IFFiVG9rZW5SZXNwb25zZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgICAgIGNvbnN0IGVuY3J5cHRlZEFjY2Vzc1Rva2VuID0gZW5jcnlwdCh0b2tlbkRhdGEuYWNjZXNzX3Rva2VuKTtcclxuICAgICAgICBjb25zdCBlbmNyeXB0ZWRSZWZyZXNoVG9rZW4gPSBlbmNyeXB0KHRva2VuRGF0YS5yZWZyZXNoX3Rva2VuKTtcclxuICAgICAgICBjb25zdCB0b2tlbkV4cGlyeSA9IG5ldyBEYXRlKERhdGUubm93KCkgKyAodG9rZW5EYXRhLmV4cGlyZXNfaW4gKiAxMDAwKSk7XHJcblxyXG4gICAgICAgIGF3YWl0IHByaXNtYS5xYkNvbm5lY3Rpb24udXBzZXJ0KHtcclxuICAgICAgICAgICAgd2hlcmU6IHsgcmVhbG1JZCB9LFxyXG4gICAgICAgICAgICB1cGRhdGU6IHtcclxuICAgICAgICAgICAgICAgIHRlbmFudElkLFxyXG4gICAgICAgICAgICAgICAgYWNjZXNzVG9rZW46IGVuY3J5cHRlZEFjY2Vzc1Rva2VuLFxyXG4gICAgICAgICAgICAgICAgcmVmcmVzaFRva2VuOiBlbmNyeXB0ZWRSZWZyZXNoVG9rZW4sXHJcbiAgICAgICAgICAgICAgICB0b2tlbkV4cGlyeSxcclxuICAgICAgICAgICAgICAgIGlzQWN0aXZlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgc3luY1N0YXR1czogJ0lETEUnXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIGNyZWF0ZToge1xyXG4gICAgICAgICAgICAgICAgdGVuYW50SWQsXHJcbiAgICAgICAgICAgICAgICByZWFsbUlkLFxyXG4gICAgICAgICAgICAgICAgYWNjZXNzVG9rZW46IGVuY3J5cHRlZEFjY2Vzc1Rva2VuLFxyXG4gICAgICAgICAgICAgICAgcmVmcmVzaFRva2VuOiBlbmNyeXB0ZWRSZWZyZXNoVG9rZW4sXHJcbiAgICAgICAgICAgICAgICB0b2tlbkV4cGlyeSxcclxuICAgICAgICAgICAgICAgIGlzQWN0aXZlOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgc3luY1N0YXR1czogJ0lETEUnXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgbG9nZ2VyLmluZm8oJ1F1aWNrQm9va3MgY29ubmVjdGlvbiBzYXZlZCcsIHsgdGVuYW50SWQsIHJlYWxtSWQgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgZ2V0Q29ubmVjdGlvbihyZWFsbUlkOiBzdHJpbmcpIHtcclxuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgcHJpc21hLnFiQ29ubmVjdGlvbi5maW5kVW5pcXVlKHtcclxuICAgICAgICAgICAgd2hlcmU6IHsgcmVhbG1JZCB9XHJcbiAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIGlmICghY29ubmVjdGlvbikge1xyXG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGNvbm5lY3Rpb24gZm91bmQgZm9yIHJlYWxtICR7cmVhbG1JZH1gKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIC4uLmNvbm5lY3Rpb24sXHJcbiAgICAgICAgICAgIGFjY2Vzc1Rva2VuOiBkZWNyeXB0KGNvbm5lY3Rpb24uYWNjZXNzVG9rZW4pLFxyXG4gICAgICAgICAgICByZWZyZXNoVG9rZW46IGRlY3J5cHQoY29ubmVjdGlvbi5yZWZyZXNoVG9rZW4pXHJcbiAgICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyByZWZyZXNoSWZOZWVkZWQocmVhbG1JZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5nZXRDb25uZWN0aW9uKHJlYWxtSWQpO1xyXG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcblxyXG4gICAgICAgIC8vIFJlZnJlc2ggaWYgdG9rZW4gZXhwaXJlcyB3aXRoaW4gNSBtaW51dGVzXHJcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24udG9rZW5FeHBpcnkgPCBuZXcgRGF0ZShub3cuZ2V0VGltZSgpICsgNSAqIDYwICogMTAwMCkpIHtcclxuICAgICAgICAgICAgbG9nZ2VyLmluZm8oJ1JlZnJlc2hpbmcgUXVpY2tCb29rcyB0b2tlbicsIHsgcmVhbG1JZCB9KTtcclxuXHJcbiAgICAgICAgICAgIGNvbnN0IG5ld1Rva2VuRGF0YSA9IGF3YWl0IHRoaXMucmVmcmVzaEFjY2Vzc1Rva2VuKGNvbm5lY3Rpb24ucmVmcmVzaFRva2VuKTtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5zYXZlQ29ubmVjdGlvbihjb25uZWN0aW9uLnRlbmFudElkLCByZWFsbUlkLCBuZXdUb2tlbkRhdGEpO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIG5ld1Rva2VuRGF0YS5hY2Nlc3NfdG9rZW47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gY29ubmVjdGlvbi5hY2Nlc3NUb2tlbjtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGNvbnN0IG9hdXRoU2VydmljZSA9IG5ldyBPQXV0aFNlcnZpY2UoKTsiXX0=