import { Job } from 'bullmq';
import { SyncEngine } from '@qb-health/ingestion';
import { prisma, RealmId } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';
import { analysisQueue } from '../queue';

export interface SyncJobData {
    realmId?: string;
    tenantId?: string;
    connectionId?: string;
    type: 'initial' | 'manual' | 'webhook' | 'scheduled';
    entityType?: string;
}

export async function syncProcessor(job: Job<SyncJobData>): Promise<{ success: boolean; results?: any[]; error?: string }> {
    let { realmId, tenantId, connectionId } = job.data;
    const { type } = job.data;

    if (!connectionId && tenantId && realmId) {
        const conn = await prisma.qbConnection.findUnique({
            where: { tenantId_realmId: { tenantId, realmId } },
            select: { id: true }
        });
        if (conn) connectionId = conn.id;
    }

    if (!connectionId) {
        throw new Error(`Sync job failed: connectionId is required for job ${job.id}`);
    }

    const connection = await prisma.qbConnection.findUnique({
        where: { id: connectionId },
        select: { id: true, realmId: true, tenantId: true, syncStatus: true, updatedAt: true }
    });

    if (!connection) {
        throw new Error(`Sync job failed: Connection not found for ID ${connectionId}`);
    }

    realmId = connection.realmId;
    tenantId = connection.tenantId;

    const jobLogger = logger.child({ jobId: job.id, realmId, type, connectionId });
    jobLogger.info('Starting sync job');

    let syncStarted = false;

    try {
        await job.updateProgress(10);

        if (type === 'initial' || type === 'manual') {
            if (connection.syncStatus === 'SYNCING') {
                const errorMsg = 'Sync already in progress';
                jobLogger.warn(`Aborting job: ${errorMsg}`);
                return { success: false, error: errorMsg };
            }

            if (type !== 'initial') {
                const minutesSinceLastUpdate = (Date.now() - connection.updatedAt.getTime()) / 60000;
                if (minutesSinceLastUpdate < 1) {
                    const errorMsg = `Cooldown active. Last updated ${minutesSinceLastUpdate.toFixed(1)} mins ago.`;
                    jobLogger.warn(`Aborting job: ${errorMsg}`);
                    return { success: false, error: 'Cooldown active' };
                }
            }
        }

        await prisma.qbConnection.update({
            where: { id: connectionId },
            data: { syncStatus: 'SYNCING', lastSyncMessage: null }
        });
        syncStarted = true;

        const syncEngine = new SyncEngine(realmId as RealmId, tenantId);
        const results = await syncEngine.runFullSync();

        await job.updateProgress(80);

        for (const result of results) {
            await prisma.syncLog.create({
                data: {
                    tenantId,
                    realmId,
                    entityType: result.entityType,
                    recordsSynced: result.recordsSynced,
                    durationMs: result.durationMs,
                    status: result.status,
                    errorMessage: result.errorMessage
                }
            });
        }

        await job.updateProgress(90);

        const successfulSyncs = results.filter((r: any) => r.status === 'SUCCESS');

        // FIX: Verify critical transactional entities didn't fail before queueing analysis
        const criticalEntities = ['Invoices', 'Bills', 'Payments', 'VendorCredits'];
        const criticalFailed = results.some((r: any) =>
            criticalEntities.includes(r.entityType) && r.status !== 'SUCCESS'
        );

        if (successfulSyncs.length > 0 && !criticalFailed) {
            // FIX: Release the sync lock immediately before queueing analysis
            await prisma.qbConnection.update({
                where: { id: connectionId },
                data: {
                    syncStatus: 'IDLE',
                    lastSyncAt: new Date(),
                    lastSyncMessage: null
                }
            });
            syncStarted = false; // Mark sync lock as safely released

            // FIX: Add jobId for deduplication
            await analysisQueue.add('run-diagnostics', {
                realmId,
                tenantId: tenantId as string,
                connectionId
            }, {
                jobId: `analysis-${connectionId}-${Date.now()}`,
                removeOnComplete: 10
            });

            if (successfulSyncs.length === results.length) {
                jobLogger.info('Sync completed successfully, analysis queued');
            } else {
                jobLogger.warn('Sync completed with partial success, analysis queued', {
                    total: results.length,
                    successful: successfulSyncs.length
                });
            }
        } else {
            const errorMsg = criticalFailed
                ? 'Sync failed for critical transactional entities, skipping analysis'
                : 'Sync failed for all entities, skipping analysis';

            jobLogger.error(errorMsg);

            await prisma.qbConnection.update({
                where: { id: connectionId },
                data: { syncStatus: 'ERROR', lastSyncMessage: errorMsg }
            });
            syncStarted = false;
        }

        await job.updateProgress(100);
        return { success: true, results };

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown sync error';
        jobLogger.error('Sync job failed', error as Error);

        if (connectionId) {
            await prisma.qbConnection.update({
                where: { id: connectionId },
                data: {
                    syncStatus: 'ERROR',
                    lastSyncMessage: errorMsg
                }
            }).catch((dbErr) => jobLogger.error('Failed to update connection error state', dbErr));
        }

        throw error;
    } finally {
        if (syncStarted && connectionId) {
            try {
                const currentConnection = await prisma.qbConnection.findUnique({
                    where: { id: connectionId },
                    select: { syncStatus: true }
                });

                if (currentConnection?.syncStatus === 'SYNCING') {
                    jobLogger.warn('Job exited while still marked as SYNCING. Forcing ERROR state.');
                    await prisma.qbConnection.update({
                        where: { id: connectionId },
                        data: {
                            syncStatus: 'ERROR',
                            lastSyncMessage: 'Job terminated unexpectedly or lost database connection.'
                        }
                    });
                }
            } catch (finallyErr) {
                jobLogger.error('Failed to execute finally block safety check', finallyErr as Error);
            }
        }
    }
}