import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    try {
        const result = await prisma.qbConnection.updateMany({
            where: { syncStatus: 'SYNCING' },
            data: { syncStatus: 'IDLE' }
        });
        console.log(`Reset ${result.count} connection(s) from SYNCING to IDLE.`);
    } catch (error) {
        console.error('Failed to reset sync status:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
