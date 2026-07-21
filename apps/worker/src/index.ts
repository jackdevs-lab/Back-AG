import 'dotenv/config';
import { Worker } from 'bullmq';
import { syncQueue } from './queue';
import { analysisProcessor, AnalysisJobData } from './processors/analysis-processor';
import { logger } from '@qb-health/utils';
import { syncProcessor } from './processors/sync-processor';

console.log(`[WORKER] Starting workers...`);
console.log(`[WORKER] Redis connection: ${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`);

// Queue error listener (Queue only emits 'error', not 'ready' or 'failed')
syncQueue.on('error', (err: Error) => {
    console.error(`[WORKER] ❌ Queue connection error:`, err);
});

const redisConfig = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null
};

// ==========================================
// 1. SYNC WORKER (This was missing!)
// ==========================================
const syncWorker = new Worker(
    'qb-sync',
    syncProcessor,
    {
        connection: redisConfig,
        concurrency: 1 // Syncs should run sequentially to avoid QuickBooks API rate limits
    }
);

syncWorker.on('completed', (job) => {
    logger.info('Sync job completed', { jobId: job.id });
});

syncWorker.on('failed', (job, err) => {
    logger.error('Sync job failed', err, { jobId: job?.id });
});

// ==========================================
// 2. ANALYSIS WORKER
// ==========================================
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

analysisWorker.on('completed', (job) => {
    logger.info('Analysis job completed', { jobId: job.id });
});

analysisWorker.on('failed', (job, error) => {
    logger.error('Analysis job failed', error, { jobId: job?.id });
});

// Graceful shutdown
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