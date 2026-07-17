import { z } from 'zod';
import { BillPaymentRawSchema, safeDate, safeDecimal } from '../shared/base-schemas';

const BillPaymentNormalizationSchema = z
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
                    .union([BillPaymentRawSchema, z.null(), z.undefined()])
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

export type NormalizedBillPayment = z.infer<typeof BillPaymentNormalizationSchema>;

export interface NormalizationResult {
    payments: NormalizedBillPayment[];
    unscannable: any[];
}

export function normalizePayments(rawRecords: any[]): NormalizationResult {
    const payments: NormalizedBillPayment[] = [];
    const unscannable: any[] = [];

    rawRecords.forEach((raw) => {
        const result = BillPaymentNormalizationSchema.safeParse(raw);
        if (result.success) {
            payments.push(result.data);
        } else {
            unscannable.push({
                qbId: (raw as any).qbId || 'Unknown',
                issue: 'CRITICAL_DATA_MISSING',
                details: result.error.flatten(),
                rawRecord: raw
            });
        }
    });

    return { payments, unscannable };
}
