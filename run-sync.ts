import 'dotenv/config';
import { SyncEngine } from './packages/ingestion/src/sync-engine';
import { PrismaClient } from './packages/financial-model/src';

async function main() {
    const prisma = new PrismaClient();
    try {
        const connection = await prisma.qbConnection.findFirst();
        if (!connection) {
            console.error("No QBO connection found.");
            return;
        }

        const engine = new SyncEngine(connection.realmId);
        console.log(`Starting sync for realm ${connection.realmId}...`);
        const results = await engine.runFullSync();
        console.log("Sync Results: ", JSON.stringify(results, null, 2));

    } catch (e) {
        console.error("Sync error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
