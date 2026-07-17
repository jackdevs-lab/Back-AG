// core/normalize/bill.ts
import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';
import { RawTransaction, RawRuleConfig } from '../data/types';

const BillRawSchemaBase = z.object({
    DocNumber: z.string().optional(),
    PrivateNote: z.string().optional(),
    CurrencyRef: z.object({
        value: z.string().optional()
    }).optional(),
    LinkedTxn: z.array(z.object({
        TxnId: z.string().optional(),
        TxnType: z.string().optional()
    })).optional(),
    MetaData: z.object({
        LastUpdatedTime: z.string().optional()
    }).optional(),
    Line: z.array(z.object({
        Amount: z.any().optional(),
        LinkedTxn: z.array(z.object({
            TxnId: z.string().optional(),
            TxnType: z.string().optional()
        })).optional()
    }).passthrough()).optional()
}).passthrough();

export const BillRawSchema = BillRawSchemaBase;

export type ParsedBillRaw = z.infer<typeof BillRawSchema>;

export interface NormalizedBill {
    id: string;
    qbId: string;
    date: Date;
    amount: Prisma.Decimal;
    vendorId: string | null;
    createdAt: Date | null;
    parsedRaw: ParsedBillRaw | null;
    parseFailed: boolean;
    parseError?: string;
}

export function parseBillRawData(rawData: unknown): { success: true; data: ParsedBillRaw } | { success: false; error: any } {
    const result = BillRawSchema.safeParse(rawData);
    if (result.success) {
        return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
}

export function normalizeBill(raw: RawTransaction): NormalizedBill {
    const parseResult = BillRawSchema.safeParse(raw.rawData);

    return {
        id: raw.id,
        qbId: raw.qbId,
        date: raw.date,
        amount: new Prisma.Decimal(raw.amount ?? 0),
        vendorId: raw.vendorId,
        createdAt: raw.createdAt,
        parsedRaw: parseResult.success ? parseResult.data : null,
        parseFailed: !parseResult.success,
        parseError: parseResult.success ? undefined : parseResult.error.message
    };
}

export interface BillDateRuleConfig {
    allowedFutureDays: number;
}

export function normalizeBillConfig(raw: RawRuleConfig): BillDateRuleConfig {
    const json = (raw?.json || {}) as Record<string, any>;
    return {
        allowedFutureDays: typeof json.allowedFutureDays === 'number' ? json.allowedFutureDays : 1
    };
}
