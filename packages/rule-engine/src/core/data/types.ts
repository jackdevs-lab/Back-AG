// core/data/types.ts
import { Prisma } from '@qb-health/financial-model';

export type RawSyncLog = {
    id: string;
    entityType: string;
    status: string;
    createdAt: Date;
};

export type RawRuleConfig = {
    json: Record<string, unknown> | null;
} | null;

export type RawTransaction = {
    id: string;
    qbId: string;
    date: Date;
    amount: Prisma.Decimal | number | null;
    rawData: unknown;
    vendorId: string | null;
    customerId: string | null;
    createdAt: Date | null;
};

export type RawVendor = {
    qbId: string;
    name: string;
    active: boolean;
};

export type RawCustomer = {
    qbId: string;
    name: string;
    active: boolean;
};

export interface FetchSyncLogsParams {
    realmId: string;
    entityTypes: string[];
}

export interface FetchTransactionsParams {
    realmId: string;
    type: string;
    lookbackDate: Date;
    hasStatusColumn: boolean;
    pageSize: number;
    cursor?: { id: string };
}

export interface FetchVendorsParams {
    realmId: string;
    vendorQbIds: string[];
}

export interface FetchCustomersParams {
    realmId: string;
    customerQbIds: string[];
}
