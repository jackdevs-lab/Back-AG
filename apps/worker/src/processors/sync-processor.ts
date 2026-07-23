// apps/worker/src/processors/sync-processor.ts
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
    let { realmId, tenantId } = job.data;
    const { type, connectionId } = job.data;

    if (!realmId && connectionId) {
        const connection = await prisma.qbConnection.findUnique({
            where: { id: connectionId },
            select: { realmId: true, tenantId: true }
        });

        if (connection) {
            realmId = connection.realmId;
            tenantId = connection.tenantId;
        }
    }

    if (!realmId || !tenantId) {
        throw new Error(`Sync job failed: realmId and tenantId are required. Got realmId: ${realmId}, tenantId: ${tenantId} for job ${job.id}`);
    }

    const jobLogger = logger.child({ jobId: job.id, realmId, type });
    jobLogger.info('Starting sync job');

    try {
        await job.updateProgress(10);

        if (type === 'initial' || type === 'manual') {
            const connection = await prisma.qbConnection.findUnique({
                where: {
                    tenantId_realmId: {
                        tenantId,
                        realmId
                    }
                },
                select: { updatedAt: true, syncStatus: true }
            });

            if (connection) {
                // Check 1: Already Syncing
                if (connection.syncStatus === 'SYNCING') {
                    const errorMsg = 'Sync already in progress';
                    jobLogger.warn(`Aborting job: ${errorMsg}`);

                    await prisma.qbConnection.update({
                        where: {
                            tenantId_realmId: {
                                tenantId,
                                realmId
                            }
                        },
                        data: { syncStatus: 'ERROR', lastSyncMessage: errorMsg }
                    });

                    return { success: false, error: errorMsg };
                }

                // Check 2: Cooldown Active (Skipped for initial syncs)
                if (type !== 'initial') {
                    const minutesSinceLastUpdate = (Date.now() - connection.updatedAt.getTime()) / 60000;
                    if (minutesSinceLastUpdate < 5) {
                        const errorMsg = `Cooldown active. Last updated ${minutesSinceLastUpdate.toFixed(1)} mins ago.`;
                        jobLogger.warn(`Aborting job: ${errorMsg}`);

                        await prisma.qbConnection.update({
                            where: {
                                tenantId_realmId: {
                                    tenantId,
                                    realmId
                                }
                            },
                            data: { syncStatus: 'ERROR', lastSyncMessage: errorMsg }
                        });

                        return { success: false, error: 'Cooldown active' };
                    }
                }
            }
        }

        const syncEngine = new SyncEngine(realmId as RealmId, tenantId);
        const results = await syncEngine.runFullSync();

        await job.updateProgress(80);

        for (const result of results) {
            await prisma.syncLog.create({
                data: {
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

        if (successfulSyncs.length > 0) {
            const connection = await prisma.qbConnection.findUnique({
                where: {
                    tenantId_realmId: {
                        tenantId,
                        realmId
                    }
                },
                select: { id: true }
            });

            await analysisQueue.add('run-diagnostics', {
                realmId,
                tenantId: tenantId as string,
                connectionId: connection?.id || ''
            }, {
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
            const errorMsg = 'Sync failed for all entities, skipping analysis';
            jobLogger.error(errorMsg);

            await prisma.qbConnection.update({
                where: {
                    tenantId_realmId: {
                        tenantId,
                        realmId
                    }
                },
                data: { syncStatus: 'ERROR', lastSyncMessage: errorMsg }
            });
        }

        await job.updateProgress(100);

        return { success: true, results };
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown sync error';
        jobLogger.error('Sync job failed', error as Error);

        await prisma.qbConnection.update({
            where: {
                tenantId_realmId: {
                    tenantId,
                    realmId
                }
            },
            data: {
                syncStatus: 'ERROR',
                lastSyncMessage: errorMsg
            }
        });

        throw error;
    }
}