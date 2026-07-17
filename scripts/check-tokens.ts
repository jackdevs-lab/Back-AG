import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    try {
        const connections = await prisma.qbConnection.findMany({
            select: { id: true, realmId: true, tokenExpiry: true, lastSyncAt: true }
        });
        console.log('Token Expiry Status:');
        const now = new Date();
        connections.forEach(c => {
            const isExpired = new Date(c.tokenExpiry) < now;
            console.log(`- Connection ${c.realmId}: Expiry ${c.tokenExpiry} (${isExpired ? 'EXPIRED' : 'VALID'})`);
        });
    } catch (error) {
        console.error('Failed to check tokens:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
