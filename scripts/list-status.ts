import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    try {
        const connections = await prisma.qbConnection.findMany({
            select: { id: true, realmId: true, companyName: true, syncStatus: true }
        });
        console.log('All Connection Statuses:');
        console.log(JSON.stringify(connections, null, 2));
    } catch (error) {
        console.error('Failed to list connections:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
