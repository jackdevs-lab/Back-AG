import 'dotenv/config';
import { Worker } from 'bullmq';
import { syncQueue } from './queue';
import { analysisProcessor, AnalysisJobData } from './processors/analysis-processor';
import { logger } from '@qb-health/utils';
import { syncProcessor } from './processors/sync-processor';
import { prisma } from '@qb-health/financial-model';

console.log(`[WORKER] Starting workers...`);
console.log(`[WORKER] Redis connection: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`);

syncQueue.on('error', (err: Error) => {
    console.error(`[WORKER] ❌ Queue connection error:`, err);
});

const redisConfig = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null
};

async function clearStaleSyncStates() {
    try {
        const result = await prisma.qbConnection.updateMany({
            where: { syncStatus: 'SYNCING' },
            data: {
                syncStatus: 'ERROR',
                // FIX: Updated to an accurate error message
                lastSyncMessage: 'Sync interrupted due to worker process restart.'
            }
        });
        if (result.count > 0) {
            logger.warn(`[WORKER] Cleared ${result.count} stale sync states on startup.`);
        }
    } catch (err) {
        logger.error('[WORKER] Failed to clear stale sync states', err);
    }
}

clearStaleSyncStates();

const syncWorker = new Worker(
    'qb-sync',
    syncProcessor,
    {
        connection: redisConfig,
        concurrency: 1
    }
);

// FIX: Removed syncWorker.on('completed') and syncWorker.on('failed') to prevent duplicate logs (handled by queue.ts)

const analysisWorker = new Worker<AnalysisJobData, {
    success: boolean;
    diagnosticRunId: string;
    healthScore: number;
    issueCount: number;
}>(
    'qb-analysis',
    analysisProcessor,
    {
        connection: redisConfig,
        concurrency: 3
    }
);

// FIX: Removed analysisWorker.on('completed') and analysisWorker.on('failed') to prevent duplicate logs (handled by queue.ts)

process.on('SIGTERM', async () => {
    logger.info('Shutting down workers...');
    await syncWorker.close();
    await analysisWorker.close();
    logger.info('Workers shut down');
    process.exit(0);
});

process.on('SIGINT', async () => {
    logger.info('Shutting down workers...');
    await syncWorker.close();
    await analysisWorker.close();
    logger.info('Workers shut down');
    process.exit(0);
});

logger.info('Worker started');