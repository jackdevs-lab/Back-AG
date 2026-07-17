import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';
import { RawTransaction, RawRuleConfig } from '../data/types';
export declare const BillRawSchema: z.ZodObject<{
    DocNumber: z.ZodOptional<z.ZodString>;
    PrivateNote: z.ZodOptional<z.ZodString>;
    CurrencyRef: z.ZodOptional<z.ZodObject<{
        value: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    LinkedTxn: z.ZodOptional<z.ZodArray<z.ZodObject<{
        TxnId: z.ZodOptional<z.ZodString>;
        TxnType: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    Line: any;
}, z.core.$loose>;
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
export declare function parseBillRawData(rawData: unknown): {
    success: true;
    data: ParsedBillRaw;
} | {
    success: false;
    error: any;
};
export declare function normalizeBill(raw: RawTransaction): NormalizedBill;
export interface BillDateRuleConfig {
    allowedFutureDays: number;
}
export declare function normalizeBillConfig(raw: RawRuleConfig): BillDateRuleConfig;
