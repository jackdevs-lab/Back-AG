// packages/ingestion/src/sync-types.ts
import { Prisma, RealmId } from '@qb-health/financial-model';

// ==========================================
// 1. RAW INTUIT QUICKBOOKS API INTERFACES
// ==========================================

export interface QboMetaData {
    CreateTime?: string;
    LastUpdatedTime?: string;
}

export interface QboRef {
    value: string;
    name?: string;
}

export interface QboLineDetail {
    ItemRef?: QboRef;
    AccountRef?: QboRef;
    ClassRef?: QboRef;
    TaxCodeRef?: QboRef;
}

export interface QboLine {
    Id?: string;
    LineNum?: number;
    Description?: string;
    Amount?: number | string;
    DetailType?: string;
    SalesItemLineDetail?: QboLineDetail;
    AccountBasedExpenseLineDetail?: QboLineDetail;
    ItemBasedExpenseLineDetail?: QboLineDetail;
    JournalEntryLineDetail?: QboLineDetail;
    DepositLineDetail?: QboLineDetail;
    Entity?: {
        Type?: string;
        EntityRef?: QboRef;
        ClearedStatus?: string;
    };
}

export interface QboAccount {
    Id: string;
    Name?: string;
    AccountType?: string;
    AccountSubType?: string;
    CurrencyRef?: QboRef;
    Active?: boolean;
    CurrentBalance?: number | string;
    MetaData?: QboMetaData;
    SyncToken?: string;
}

export interface QboCustomer {
    Id: string;
    DisplayName?: string;
    CompanyName?: string;
    PrimaryEmailAddr?: { Address?: string };
    PrimaryPhone?: { FreeFormNumber?: string };
    Active?: boolean;
    Balance?: number | string;
    MetaData?: QboMetaData;
    SyncToken?: string;
}

export interface QboVendor {
    Id: string;
    DisplayName?: string;
    CompanyName?: string;
    PrimaryEmailAddr?: { Address?: string };
    Active?: boolean;
    MetaData?: QboMetaData;
    SyncToken?: string;
}

export interface QboTransaction {
    Id: string;
    TxnDate?: string;
    TotalAmt?: number | string;
    Amount?: number | string;
    Balance?: number | string;
    UnappliedAmt?: number | string;
    Status?: string;
    PrivateNote?: string;
    SyncToken?: string;
    DepartmentRef?: QboRef;
    CustomerRef?: QboRef;
    VendorRef?: QboRef;
    EntityRef?: QboRef;
    DepositToAccountRef?: QboRef;
    AccountRef?: QboRef;
    FromAccountRef?: QboRef;
    ToAccountRef?: QboRef;
    Line?: QboLine[];
    MetaData?: QboMetaData;
}

// ==========================================
// 2. MAPPED DATABASE ENTITY TYPES (Prisma Parity)
// ==========================================

export type MappedAccount = Prisma.AccountCreateInput;
export type MappedCustomer = Prisma.CustomerCreateInput;
export type MappedVendor = Prisma.VendorCreateInput;

export interface MappedTransaction {
    id: string; // Compound ID: ${realmId}-${qbId}
    realmId: string;
    qbId: string;
    type: string;
    date: Date;
    amount: Prisma.Decimal;
    status: string;
    isReconciled: boolean;
    categoryId?: string | null;
    customerId?: string | null;
    vendorId?: string | null;
    rawData: Prisma.InputJsonValue;
    syncToken: number;
    lastSyncedAt: Date;
    updatedAt: Date;
    createdAt: Date;
}

export interface MappedBankTransaction {
    id: string; // Compound ID: ${realmId}-${qbId}
    realmId: string;
    qbId: string;
    accountId: string; // Compound ID: ${realmId}-${rawAccountId}
    date: Date;
    amount: Prisma.Decimal;
    description?: string | null;
    payee?: string | null;
    status: string;
    rawData: Prisma.InputJsonValue;
    lastSyncedAt: Date;
    updatedAt: Date;
    createdAt: Date;
}

export interface MappedReconciliation {
    id: string; // Compound ID: ${realmId}-${qbId}
    realmId: string;
    qbId: string;
    accountId: string;
    startDate?: Date | null;
    endDate: Date;
    openingBalance: Prisma.Decimal;
    closingBalance: Prisma.Decimal;
    status: string;
    rawData: Prisma.InputJsonValue;
    lastSyncedAt: Date;
    updatedAt: Date;
    createdAt: Date;
}

// ==========================================
// 3. PIPELINE & EXECUTION METADATA
// ==========================================

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

export interface SyncResult {
    realmId: RealmId;
    entityType: string;
    recordsSynced: number;
    durationMs: number;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    errorMessage?: string;
}

export interface SyncReport {
    realmId: RealmId;
    syncResults: SyncResult[];
    totalRecordsSynced: number;
    totalDurationMs: number;
    overallStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    overallErrorMessage?: string;
}

export interface BatchUpsertOptions {
    chunkSize?: number;
    maxRetries?: number;
}