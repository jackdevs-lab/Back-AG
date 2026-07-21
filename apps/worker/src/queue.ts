// apps/worker/src/queue.ts
import { Queue, QueueEvents } from 'bullmq';
import { logger } from '@qb-health/utils';

const redisConfig = {
    url: process.env.REDIS_URL,
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