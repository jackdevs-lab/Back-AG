import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    try {
        const logs = await prisma.syncLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 10
        });
        console.log('Recent Sync Logs:');
        console.log(JSON.stringify(logs, null, 2));
    } catch (error) {
        console.error('Failed to list sync logs:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
