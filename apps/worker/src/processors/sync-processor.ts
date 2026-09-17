import { Job } from 'bullmq';
import { SyncEngine } from '@qb-health/ingestion';
import { prisma, RealmId, TenantId } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';
import { analysisQueue, redis } from '../queue';
import { createQbClient } from '@qb-health/qb-client';
import crypto from 'crypto';

export interface SyncJobData {
    realmId?: string;
    tenantId?: string;
    connectionId?: string;
    type: 'initial' | 'manual' | 'webhook' | 'scheduled';
    entityType?: string;
    correlationId?: string;
}

export interface SyncProcessorResult {
    success: boolean;
    results?: Array<{
        entityType: string;
        recordsSynced: number;
        durationMs: number;
        status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
        errorMessage?: string;
    }>;
    error?: string;
    partialFailure?: boolean;
    analysisSkipped?: boolean;
}

export async function syncProcessor(job: Job<SyncJobData>): Promise<SyncProcessorResult> {
    let { realmId, tenantId, connectionId } = job.data;
    const { type } = job.data;
    const correlationId = job.data.correlationId || crypto.randomUUID();

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
        select: { id: true, realmId: true, tenantId: true, syncStatus: true, updatedAt: true, lastHeartbeatAt: true }
    });

    if (!connection) {
        throw new Error(`Sync job failed: Connection not found for ID ${connectionId}`);
    }

    realmId = connection.realmId;
    tenantId = connection.tenantId;

    const typedRealmId = realmId as RealmId;
    const typedTenantId = tenantId as TenantId;

    // Attach correlationId to logger
    const jobLogger = logger.child({ jobId: job.id, realmId: typedRealmId, tenantId: typedTenantId, type, connectionId, correlationId });

    // Validate cooldown FIRST
    if (type !== 'initial') {
        const minutesSinceLastUpdate = (Date.now() - connection.updatedAt.getTime()) / 60000;
        if (minutesSinceLastUpdate < 1) {
            jobLogger.warn('Aborting job: Cooldown active');
            return { success: false, error: 'Cooldown active' };
        }
    }

    // Acquire Redis execution lock
    const lockKey = `sync-lock:${connectionId}`;
    const lock = await redis.set(lockKey, '1', 'EX', 300, 'NX');
    if (!lock) {
        jobLogger.warn('Sync skipped: lock held by another worker');
        return { success: false, error: 'Sync in progress' };
    }

    // Log ONLY after validation passes
    jobLogger.info('Starting sync job');

    let syncStarted = false;
    let heartbeatInterval: NodeJS.Timeout | null = null;

    try {
        await job.updateProgress(10);

        if (type === 'initial' || type === 'manual') {
            const staleThreshold = new Date(Date.now() - 2 * 60_000);
            const isActivelySyncing = connection.syncStatus === 'SYNCING' &&
                connection.lastHeartbeatAt &&
                connection.lastHeartbeatAt > staleThreshold;

            if (isActivelySyncing) {
                const errorMsg = 'Sync already in progress';
                jobLogger.warn(`Aborting job: ${errorMsg}`);
                return { success: false, error: errorMsg };
            }
        }

        // Initialize SYNCING state and immediate heartbeat timestamp
        await prisma.qbConnection.update({
            where: { id: connectionId },
            data: {
                syncStatus: 'SYNCING',
                lastSyncMessage: null,
                lastHeartbeatAt: new Date()
            }
        });
        syncStarted = true;

        // Start heartbeat emitter every 15 seconds
        heartbeatInterval = setInterval(async () => {
            try {
                await prisma.qbConnection.update({
                    where: { id: connectionId },
                    data: { lastHeartbeatAt: new Date() }
                });
            } catch (hbError) {
                jobLogger.error('Failed to update sync heartbeat', hbError as Error);
            }
        }, 15_000);

        const qbClient = await createQbClient(typedRealmId, typedTenantId);
        const syncEngine = new SyncEngine(typedRealmId, typedTenantId, qbClient, connection.id);
        const results = await syncEngine.runFullSync();

        await job.updateProgress(80);

        for (const result of results) {
            await prisma.syncLog.create({
                data: {
                    tenantId: typedTenantId,
                    realmId: typedRealmId,
                    entityType: result.entityType,
                    recordsSynced: result.recordsSynced,
                    durationMs: result.durationMs,
                    status: result.status,
                    errorMessage: result.errorMessage,
                    correlationId // Persist correlationId for traceability
                }
            });
        }

        await job.updateProgress(90);

        const criticalEntities = [
            'Invoice', 'Bill', 'Payment', 'VendorCredit',
            'Purchase', 'JournalEntry', 'Deposit', 'Transfer',
        ];

        const partialFailure = results.some((r) =>
            criticalEntities.includes(r.entityType) && r.status !== 'SUCCESS'
        );

        if (partialFailure) {
            const errorMsg = 'Sync failed for critical transactional entities, skipping analysis';
            jobLogger.warn('Skipping diagnostic analysis due to critical entity sync failure');

            await prisma.qbConnection.update({
                where: { id: connectionId },
                data: { syncStatus: 'ERROR', lastSyncMessage: errorMsg }
            });
            syncStarted = false;

            await job.updateProgress(100);
            return { success: true, results, partialFailure: true, analysisSkipped: true };
        }

        await prisma.qbConnection.update({
            where: { id: connectionId },
            data: {
                syncStatus: 'IDLE',
                lastSyncAt: new Date(),
                lastSyncMessage: null
            }
        });
        syncStarted = false;

        // Forward correlationId to analysis worker
        await analysisQueue.add('run-diagnostics', {
            realmId: typedRealmId,
            tenantId: typedTenantId,
            connectionId,
            correlationId
        }, {
            jobId: `analysis-${connectionId}-${Date.now()}`,
            removeOnComplete: 10
        });

        jobLogger.info('Sync completed successfully, analysis queued');

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
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
        }

        await redis.del(lockKey);

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