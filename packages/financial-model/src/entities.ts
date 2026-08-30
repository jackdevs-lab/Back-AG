import { Brand } from '@qb-health/utils';

// Primary Keys
export type TenantId = Brand<string, 'TenantId'>;
export type UserId = Brand<string, 'UserId'>;
export type QbConnectionId = Brand<string, 'QbConnectionId'>;
export type RuleFindingId = Brand<string, 'RuleFindingId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type CustomerId = Brand<string, 'CustomerId'>;
export type VendorId = Brand<string, 'VendorId'>;
export type DiagnosticRunId = Brand<string, 'DiagnosticRunId'>;
export type DiagnosticCheckId = Brand<string, 'DiagnosticCheckId'>;
export type IssueId = Brand<string, 'IssueId'>;
export type SyncLogId = Brand<string, 'SyncLogId'>;
export type BankTransactionId = Brand<string, 'BankTransactionId'>;
export type ReconciliationId = Brand<string, 'ReconciliationId'>;
export type RuleConfigId = Brand<string, 'RuleConfigId'>; // Note: RuleConfig now uses composite key, but this ID may be unused or derived

// Logical/Foreign Keys
export type RealmId = Brand<string, 'RealmId'>; // QuickBooks company ID
export type QbId = Brand<string, 'QbId'>; // QuickBooks resource ID
export type RuleId = Brand<string, 'RuleId'>; // Rule ID

// Currencies
export type Currency = Brand<string, 'Currency'>; // e.g. "USD", "EUR"

// Status Strings
export type SubscriptionStatus = 'ACTIVE' | 'INACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'CANCELED';
export type BrandedSubscriptionStatus = Brand<SubscriptionStatus, 'SubscriptionStatus'>;

export type SyncStatus = 'IDLE' | 'SYNCING' | 'ERROR';
export type BrandedSyncStatus = Brand<SyncStatus, 'SyncStatus'>;

export type DiagnosticRunStatus = 'COMPLETED' | 'FAILED' | 'PENDING';
export type BrandedDiagnosticRunStatus = Brand<DiagnosticRunStatus, 'DiagnosticRunStatus'>;

export type DiagnosticCheckStatus = 'PASSED' | 'FAILED' | 'WARNING' | 'ERROR';
export type BrandedDiagnosticCheckStatus = Brand<DiagnosticCheckStatus, 'DiagnosticCheckStatus'>;

export type TransactionStatus = 'Completed' | 'Void' | 'Paid' | 'Open' | 'UNMATCHED';
export type BrandedTransactionStatus = Brand<TransactionStatus, 'TransactionStatus'>;

// Domain Entity Interfaces
export interface Tenant {
    id: TenantId;
    name: string;
    email: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface User {
    id: UserId;
    tenantId: TenantId;
    email: string;
    role: string;
    createdAt: Date;
}

export interface QbConnection {
    id: QbConnectionId;
    tenantId: TenantId;
    realmId: RealmId;
    companyName: string | null;
    accessToken: string;
    refreshToken: string;
    tokenExpiry: Date;
    lastSyncAt: Date | null;
    syncStatus: BrandedSyncStatus;
    isActive: boolean;
    subscriptionStatus: BrandedSubscriptionStatus;
    paystackCustCode: string | null;
    paystackPlanCode: string | null;
    paystackSubscriptionCode?: string | null; // added if present in schema
    billingCycle?: string | null;
    currentPeriodEnd?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    timezone: string;
    lastSyncMessage?: string | null;
}

export interface RuleFinding {
    id: RuleFindingId;
    tenantId: TenantId; // NEW
    realmId: RealmId;
    ruleId: RuleId;
    qbId: QbId;
    syncToken: number;
    findingData: any;
    createdAt: Date;
}

export interface Account {
    id: AccountId;
    tenantId: TenantId; // NEW
    realmId: RealmId;
    qbId: QbId;
    name: string;
    type: string;
    subType: string | null;
    currency: Currency;
    active: boolean;
    balance: any; // Decimal
    lastSyncedAt?: Date; // present in schema, optional if not used?
    updatedAt: Date;
    createdAt: Date;
}

export interface Transaction {
    id: TransactionId;
    tenantId: TenantId; // NEW
    realmId: RealmId;
    qbId: QbId;
    type: string;
    date: Date;
    amount: any; // Decimal
    status: BrandedTransactionStatus;
    isReconciled?: boolean; // present in schema
    categoryId: string | null;
    customerId: CustomerId | null;
    vendorId: VendorId | null;
    rawData: any;
    syncToken: number;
    lastSyncedAt?: Date;
    updatedAt: Date;
    createdAt: Date;
}

export interface Customer {
    id: CustomerId;
    tenantId: TenantId; // NEW
    realmId: RealmId;
    qbId: QbId;
    name: string;
    email: string | null;
    phone: string | null;
    active: boolean;
    balance: any; // Decimal
    lastSyncedAt?: Date;
    updatedAt: Date;
    createdAt: Date;
}

export interface Vendor {
    id: VendorId;
    tenantId: TenantId; // NEW
    realmId: RealmId;
    qbId: QbId;
    name: string;
    email: string | null;
    active: boolean;
    lastSyncedAt?: Date;
    updatedAt: Date;
    createdAt: Date;
}

export interface DiagnosticRun {
    id: DiagnosticRunId;
    tenantId: TenantId; // already present
    runAt: Date;
    healthScore: number;
    status: BrandedDiagnosticRunStatus;
    errorMessage: string | null;
    metadata: any;
    connectionId: QbConnectionId | null;
}

export interface DiagnosticCheck {
    id: DiagnosticCheckId;
    runId: DiagnosticRunId;
    ruleId: RuleId;
    ruleName: string;
    category: string;
    severity: string | null;
    status: BrandedDiagnosticCheckStatus;
    message: string | null;
    durationMs: number | null;
    createdAt: Date;
}

export interface Issue {
    id: IssueId;
    connectionId: QbConnectionId;
    runId: DiagnosticRunId;
    ruleId: RuleId;
    ruleName: string;
    severity: string;
    message: string;
    fingerprint: string | null;
    entities: any;
    isResolved: boolean;
    resolvedAt: Date | null;
    createdAt: Date;
}

export interface SyncLog {
    id: SyncLogId;
    tenantId: TenantId; // NEW
    realmId: RealmId;
    entityType: string;
    recordsSynced: number;
    durationMs: number;
    status: string;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface BankTransaction {
    id: BankTransactionId;
    tenantId: TenantId; // NEW
    realmId: RealmId;
    qbId: QbId;
    accountId: AccountId;
    date: Date;
    amount: any; // Decimal
    description: string | null;
    payee: string | null;
    status: BrandedTransactionStatus;
    rawData: any;
    lastSyncedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface Reconciliation {
    id: ReconciliationId;
    tenantId: TenantId; // NEW
    realmId: RealmId;
    qbId: QbId;
    accountId: AccountId;
    startDate: Date | null;
    endDate: Date;
    openingBalance: any; // Decimal
    closingBalance: any; // Decimal
    status: BrandedTransactionStatus;
    rawData: any;
    lastSyncedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

export interface RuleConfig {
    tenantId: TenantId; // NEW
    realmId: RealmId;
    ruleId: RuleId;
    json: any;
    updatedAt: Date;
}