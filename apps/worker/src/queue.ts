import { Queue, QueueEvents } from 'bullmq';
import { logger } from '@qb-health/utils';
import Redis from 'ioredis';

export const redisConfig = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null
};

// Export an active Redis client instance
export const redis = new Redis(redisConfig);

export const syncQueue = new Queue('qb-sync', { connection: redisConfig });
export const analysisQueue = new Queue('qb-analysis', { connection: redisConfig });

export const syncQueueEvents = new QueueEvents('qb-sync', { connection: redisConfig });
export const analysisQueueEvents = new QueueEvents('qb-analysis', { connection: redisConfig });

syncQueueEvents.on('completed', ({ jobId }) => {
    logger.info('Sync job completed', { jobId });
});

syncQueueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error('Sync job failed', { jobId, reason: failedReason });
});

syncQueueEvents.on('stalled', ({ jobId }) => {
    logger.warn('Sync job stalled (worker lock lost)', { jobId });
});

analysisQueueEvents.on('completed', ({ jobId }) => {
    logger.info('Analysis job completed', { jobId });
});

analysisQueueEvents.on('failed', ({ jobId, failedReason }) => {
    logger.error('Analysis job failed', { jobId, reason: failedReason });
});

analysisQueueEvents.on('stalled', ({ jobId }) => {
    logger.warn('Analysis job stalled (worker lock lost)', { jobId });
});