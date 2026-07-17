// packages/ingestion/src/sync-types.ts
import { RealmId, QbId } from '@qb-health/financial-model';

export interface SyncResult {
    realmId: RealmId;
    entityType: string;
    recordsSynced: number;
    durationMs: number;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    errorMessage?: string;
}

export interface QbEntity {
    Id: QbId;
    MetaData?: {
        LastUpdatedTime: string;
        CreateTime: string;
    };
    [key: string]: any;
}

export type SupportedEntityType =
    | 'Account'
    | 'Customer'
    | 'Vendor'
    | 'Invoice'
    | 'Bill'
    | 'Payment'
    | 'Purchase'
    | 'JournalEntry'
    | 'Deposit'
    | 'Transfer'
    | 'BankTransaction'
    | 'Reconciliation';

export interface BatchUpsertOptions {
    chunkSize?: number;
    maxRetries?: number;
}
export interface SyncReport {
    realmId: RealmId;
    syncResults: SyncResult[];
    totalRecordsSynced: number;
    totalDurationMs: number;
    overallStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    overallErrorMessage?: string;
}
