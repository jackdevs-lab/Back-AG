// apps/worker/src/queue.ts
import { Queue, QueueEvents } from 'bullmq';
import { logger } from '@qb-health/utils';

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null
};

export const syncQueue = new Queue('qb-sync', { connection: redisConfig });
export const analysisQueue = new Queue('qb-analysis', { connection: redisConfig });

export const syncQueueEvents = new QueueEvents('qb-sync', { connection: redisConfig });
export const analysisQueueEvents = new QueueEvents('qb-analysis', { connection: redisConfig });

// Log queue events - Keep these light and clean
syncQueueEvents.on('completed', ({ jobId }) => {
    logger.info('Sync job completed', { jobId });
});

syncQueueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error('Sync job failed', { jobId, reason: failedReason });
});

analysisQueueEvents.on('completed', ({ jobId }) => {
    logger.info('Analysis job completed', { jobId });
});

analysisQueueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error('Analysis job failed', { jobId, reason: failedReason });
});