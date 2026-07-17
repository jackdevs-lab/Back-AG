import 'dotenv/config';
import { SyncEngine } from '../packages/ingestion/src/sync-engine';
import { prisma } from '@qb-health/financial-model';

async function runSync() {
    console.log('--- Triggering Full Sync for New Entities ---');
    
    // Find a connection to test with
    const connection = await prisma.qbConnection.findFirst({
        where: { isActive: true }
    });

    if (!connection) {
        console.error('No active QuickBooks connection found.');
        return;
    }

    console.log(`Syncing connection: ${connection.realmId} (${connection.companyName})`);

    const engine = new SyncEngine(connection.realmId);
    const results = await engine.runFullSync();

    console.log('\n--- Sync Results ---');
    results.forEach(res => {
        const icon = res.status === 'SUCCESS' ? '✅' : '❌';
        console.log(`${icon} [${res.entityType}]: ${res.recordsSynced} records synced in ${res.durationMs}ms`);
        if (res.status === 'FAILED') {
            console.error(`   Error: ${res.errorMessage}`);
        }
    });
}

runSync()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
