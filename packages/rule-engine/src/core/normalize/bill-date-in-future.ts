import { z } from 'zod';
import { BillRawSchema, safeDate, safeDecimal } from '../shared/base-schemas';

const BillNormalizationSchema = z
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

                date: safeDate.optional(),
                billDate: safeDate.optional(),

                amount: safeDecimal,
                currency: z.string().optional().default('USD'),
                status: z.string().optional().default('OPEN'),

                syncToken: z
                    .union([z.string(), z.number()])
                    .nullable()
                    .optional()
                    .transform((val) => (val != null ? String(val) : null)),

                rawData: z
                    .union([BillRawSchema, z.null(), z.undefined()])
                    .optional()
                    .transform((val) => val ?? null),
            })
            .refine((data) => data.date !== undefined || data.billDate !== undefined, {
                message: "CRITICAL: Both 'date' and 'billDate' are missing.",
                path: ["date"],
            })
            .passthrough()
            .transform((data) => {
                const normalizedDate = (data.billDate ?? data.date) as Date;

                return {
                    id: data.id,
                    qbId: data.qbId,
                    date: normalizedDate,
                    amount: data.amount,
                    currency: data.currency,
                    status: data.status,
                    syncToken: data.syncToken,
                    parsedRaw: data.rawData,
                };
            })
    );

export type NormalizedBill = z.infer<typeof BillNormalizationSchema>;

export interface NormalizationResult {
    bills: NormalizedBill[];
    unscannable: any[];
}

export function normalizeBills(rawRecords: any[]): NormalizationResult {
    const bills: NormalizedBill[] = [];
    const unscannable: any[] = [];

    rawRecords.forEach((raw) => {
        const result = BillNormalizationSchema.safeParse(raw);
        if (result.success) {
            bills.push(result.data);
        } else {
            unscannable.push({
                qbId: (raw as any).qbId || 'Unknown',
                issue: 'CRITICAL_DATA_MISSING',
                details: result.error.flatten(),
                rawRecord: raw
            });
        }
    });

    return { bills, unscannable };
}
