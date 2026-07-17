/* import { Job } from 'bullmq';
import { SyncEngine } from '@qb-health/ingestion';
import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';
import { analysisQueue } from '../queue';

export async function syncProcessor(job: Job) {
    const { realmId, tenantId, type } = job.data;
    const jobLogger = logger.child({ jobId: job.id, realmId, type, forcedMode: 'FULL_SNAPSHOT' });

    jobLogger.info('Starting full snapshot sync job');

    try {
        await job.updateProgress(10);

        const syncEngine = new SyncEngine(realmId);

        // 1 & 2. Branching logic removed.
        // 3. Forced Full Sync Engine execution for all incoming jobs.
        const results = await syncEngine.runFullSync();

        await job.updateProgress(80);

        // 4. Execution tracking logs (SyncLog) written as an all-inclusive historical snapshot
        for (const result of results) {
            await prisma.syncLog.create({
                data: {
                    realmId,
                    entityType: result.entityType,
                    recordsSynced: result.recordsSynced,
                    durationMs: result.durationMs,
                    status: result.status,
                    errorMessage: result.errorMessage,
                    // Optional: If your prisma schema supports it, explicitly flag the snapshot type:
                    // syncType: 'FULL_SNAPSHOT' 
                }
            });
        }

        await job.updateProgress(90);

        // Queue analysis job after sync.
        // We only suppress diagnostics if the Payment entity itself failed — a failure in
        // Transfer, JournalEntry, etc. should not block orphaned-payment or AR rules from
        // running against whatever Payment data we do have.
        const paymentResult = results.find(r => r.entityType === 'Payment');
        const paymentSyncOk = !paymentResult || paymentResult.status !== 'FAILED';

        if (paymentSyncOk) {
            const failedEntities = results.filter(r => r.status === 'FAILED').map(r => r.entityType);
            if (failedEntities.length > 0) {
                jobLogger.warn('Some entity syncs failed, but Payment succeeded — analysis will proceed', {
                    failedEntities
                });
            }

            await analysisQueue.add('run-diagnostics', {
                realmId,
                tenantId,
                connectionId: await getConnectionId(realmId)
            }, {
                jobId: `analysis-${realmId}-${Date.now()}`,
                removeOnComplete: 10
            });

            jobLogger.info('Full snapshot sync completed, analysis queued');
        } else {
            jobLogger.warn('Payment sync failed — analysis suppressed to avoid stale-data diagnostics', {
                paymentResult
            });
        }

        await job.updateProgress(100);

        return { success: true, results };
    } catch (error) {
        jobLogger.error('Full snapshot sync job failed', error as Error);

        await prisma.qbConnection.update({
            where: { realmId },
            data: { syncStatus: 'ERROR' }
        });

        throw error;
    }
}

async function getConnectionId(realmId: string): Promise<string> {
    const connection = await prisma.qbConnection.findUnique({
        where: { realmId },
        select: { id: true }
    });
    return connection?.id || '';
}*/