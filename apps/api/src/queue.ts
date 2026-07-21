// apps/api/src/queue.ts
import { Queue, QueueEvents } from 'bullmq';
import { EventEmitter } from 'events';

const redisConfig = {
    url: process.env.REDIS_URL,
    maxRetriesPerRequest: null
};


export const syncQueue = new Queue('qb-sync', { connection: redisConfig });
export const analysisQueue = new Queue('qb-analysis', { connection: redisConfig });

export const analysisQueueEvents = new QueueEvents('qb-analysis', { connection: redisConfig });
export const sseEventEmitter = new EventEmitter();

analysisQueueEvents.on('completed', async ({ jobId, returnvalue }) => {
    try {
        const job = await analysisQueue.getJob(jobId);
        if (job && job.data && job.data.connectionId) {
            let runId = '';
            if (returnvalue) {
                try {
                    const parsed = typeof returnvalue === 'string' ? JSON.parse(returnvalue) : returnvalue;
                    runId = parsed.diagnosticRunId || '';
                } catch (parseErr) {
                    console.error('Failed to parse returnvalue in completed event:', parseErr);
                }
            }
            sseEventEmitter.emit(`run_completed:${job.data.connectionId}`, { runId });
        }
    } catch (err) {
        console.error('Error in analysis QueueEvents completed handler:', err);
    }
});