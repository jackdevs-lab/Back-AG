import { z } from 'zod';
import { BillRawSchema, safeDate, safeDecimal } from '../shared/base-schemas';

const MultipleBillsNormalizationSchema = z
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
                rawData: z
                    .union([BillRawSchema, z.null(), z.undefined()])
                    .optional()
                    .transform((val) => val ?? null),
            })
            .passthrough()
            .transform((data) => ({
                id: data.id,
                qbId: data.qbId,
                vendorId: data.vendorId,
                date: data.date,
                amount: data.amount,
                currency: data.currency,
                parsedRaw: data.rawData,
            }))
    );

export type NormalizedMultipleBill = z.infer<typeof MultipleBillsNormalizationSchema>;

export interface NormalizationResult {
    bills: NormalizedMultipleBill[];
    unscannable: any[];
}

export function normalizeBills(rawRecords: any[]): NormalizationResult {
    const bills: NormalizedMultipleBill[] = [];
    const unscannable: any[] = [];

    rawRecords.forEach((raw) => {
        const result = MultipleBillsNormalizationSchema.safeParse(raw);
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
