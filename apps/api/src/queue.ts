import { Queue, QueueEvents } from 'bullmq';
import { EventEmitter } from 'events';

const redisConfig = {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
};

// Queues
export const syncQueue = new Queue('qb-sync', { connection: redisConfig });
export const analysisQueue = new Queue('qb-analysis', { connection: redisConfig });

// Queue Events
export const syncQueueEvents = new QueueEvents('qb-sync', { connection: redisConfig });
export const analysisQueueEvents = new QueueEvents('qb-analysis', { connection: redisConfig });

// Global SSE Event Emitter
export const sseEventEmitter = new EventEmitter();

/**
 * Sync Completion Listener
 * Emits sync_completed ONLY. Explicitly MUST NOT emit run_completed.
 */
syncQueueEvents.on('completed', async ({ jobId }) => {
    try {
        const job = await syncQueue.getJob(jobId);
        if (job?.data?.connectionId) {
            sseEventEmitter.emit(`sync_completed:${job.data.connectionId}`, {
                connectionId: job.data.connectionId,
                status: 'SYNC_COMPLETED'
            });
        }
    } catch (err) {
        console.error('Error in sync QueueEvents completed handler:', err);
    }
});

/**
 * Analysis Completion Listener
 * Sole trigger for run_completed SSE event.
 */
analysisQueueEvents.on('completed', async ({ jobId, returnvalue }) => {
    try {
        const job = await analysisQueue.getJob(jobId);
        if (job?.data?.connectionId) {
            let runId = '';
            if (returnvalue) {
                try {
                    const parsed = typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
                    runId = parsed.diagnosticRunId || parsed.runId || '';
                } catch (parseErr) {
                    console.error('Failed to parse returnvalue in completed event:', parseErr);
                }
            }

            // Exclusively emit run_completed upon analysis completion
            sseEventEmitter.emit(`run_completed:${job.data.connectionId}`, {
                connectionId: job.data.connectionId,
                runId,
                status: 'COMPLETED'
            });
        }
    } catch (err) {
        console.error('Error in analysis QueueEvents completed handler:', err);
    }
});