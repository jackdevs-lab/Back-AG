// scripts/force-refresh.ts
const path = require('path');
const fs = require('fs');

// Simple relative require for the necessary services
const { OAuthService } = require('../packages/qb-client/src/oauth');
const { prisma } = require('../packages/financial-model/src/index');
const { QbApiClient } = require('../packages/qb-client/src/api-client');

async function forceRefresh() {
    const realmId = '9341455972977269';
    console.log(`--- Forcing Refresh for Realm: ${realmId} ---`);
    
    const oauthService = new OAuthService();
    
    try {
        const connection = await oauthService.getConnection(realmId);
        console.log('Current Expiry:', connection.tokenExpiry);
        
        console.log('Refreshing...');
        const newTokenData = await oauthService.refreshAccessToken(connection.refreshToken);
        console.log('Refresh Succeeded!');
        
        await oauthService.saveConnection(connection.tenantId, realmId, newTokenData);
        console.log('New Token Saved.');
        
        const client = new QbApiClient(realmId, newTokenData.access_token);
        const info = await client.getCompanyInfo();
        console.log('Successfully connected to:', info.CompanyInfo.CompanyName);
    } catch (e) {
        console.error('FAILED:', e.message);
        if (e.response) {
            console.error('Response Data:', JSON.stringify(e.response.data, null, 2));
        }
    }
}

forceRefresh()
    .finally(() => prisma.$disconnect());
