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

async function startWorkers() {
    // 1. Ensure stale states are fully cleared before workers start taking jobs
    await clearStaleSyncStates();

    // 2. Worker setup with extended lock duration (5 mins) to prevent false-positive job stalls
    const syncWorker = new Worker(
        'qb-sync',
        syncProcessor,
        {
            connection: redisConfig,
            concurrency: 1,
            lockDuration: 300000, // 5 minutes
            lockRenewTime: 15000,   // Heartbeat every 15s
            maxStalledCount: 2
        }
    );

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
            concurrency: 2,
            lockDuration: 300000, // 5 minutes
            lockRenewTime: 15000,
            maxStalledCount: 2
        }
    );

    const shutdown = async (signal: string) => {
        logger.info(`Received ${signal}. Shutting down workers...`);
        await syncWorker.close();
        await analysisWorker.close();
        await prisma.$disconnect();
        logger.info('Workers and database connection shut down cleanly');
        process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    logger.info('Worker started successfully');
}

startWorkers().catch((err) => {
    logger.error('Fatal error starting worker process', err);
    process.exit(1);
});