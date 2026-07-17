import { z } from 'zod';
import { BillRawSchema, PurchaseRawSchema, safeDate, safeDecimal } from '../shared/base-schemas';

const TransactionNormalizationSchema = z
    .preprocess(
        (raw) => raw ?? {},
        z
            .object({
                id: z.union([z.string(), z.number()]).transform((val) => String(val)),
                qbId: z
                    .union([z.string(), z.number()])
                    .nullable()
                    .optional()
                    .transform((val) => (val != null ? String(val) : null)),
                vendorId: z
                    .union([z.string(), z.number()])
                    .nullable()
                    .optional()
                    .transform((val) => (val != null ? String(val) : null)),
                date: safeDate,
                amount: safeDecimal,
                currency: z.string().optional().default('USD'),
                type: z.string(),
                rawData: z.any().optional()
            })
            .passthrough()
            .transform((data) => ({
                id: data.id,
                qbId: data.qbId,
                vendorId: data.vendorId,
                date: data.date,
                amount: data.amount,
                currency: data.currency,
                type: data.type,
                parsedRaw: data.rawData,
            }))
    );

export type NormalizedTransaction = z.infer<typeof TransactionNormalizationSchema>;

export interface NormalizationResult {
    transactions: NormalizedTransaction[];
    unscannable: any[];
}

export function normalizeTransactions(rawRecords: any[]): NormalizationResult {
    const transactions: NormalizedTransaction[] = [];
    const unscannable: any[] = [];

    rawRecords.forEach((raw) => {
        const result = TransactionNormalizationSchema.safeParse(raw);
        if (result.success) {
            transactions.push(result.data);
        } else {
            unscannable.push({
                qbId: (raw as any).qbId || 'Unknown',
                issue: 'CRITICAL_DATA_MISSING',
                details: result.error.flatten(),
                rawRecord: raw
            });
        }
    });

    return { transactions, unscannable };
}
