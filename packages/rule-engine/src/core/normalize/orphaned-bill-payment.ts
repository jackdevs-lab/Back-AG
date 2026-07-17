import { z } from 'zod';
import { BillPaymentRawSchema, safeDate, safeDecimal } from '../shared/base-schemas';

const OrphanedBillPaymentNormalizationSchema = z
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
            .transform((data) => {
                const linkedBillIds: string[] = [];
                if (data.rawData?.Line) {
                    const lines = Array.isArray(data.rawData.Line) ? data.rawData.Line : [data.rawData.Line];
                    lines.forEach((l: any) => {
                        const links = Array.isArray(l.LinkedTxn) ? l.LinkedTxn : [l.LinkedTxn];
                        links.forEach((link: any) => {
                            if (String(link?.TxnType).toLowerCase() === 'bill' && link?.TxnId) {
                                linkedBillIds.push(String(link.TxnId));
                            }
                        });
                    });
                }

                return {
                    id: data.id,
                    qbId: data.qbId,
                    vendorId: data.vendorId,
                    date: data.date,
                    amount: data.amount,
                    currency: data.currency,
                    linkedBillIds: [...new Set(linkedBillIds)],
                    parsedRaw: data.rawData,
                };
            })
    );

export type NormalizedOrphanedBillPayment = z.infer<typeof OrphanedBillPaymentNormalizationSchema>;

export interface NormalizationResult {
    payments: NormalizedOrphanedBillPayment[];
    unscannable: any[];
}

export function normalizePayments(rawRecords: any[]): NormalizationResult {
    const payments: NormalizedOrphanedBillPayment[] = [];
    const unscannable: any[] = [];

    rawRecords.forEach((raw) => {
        const result = OrphanedBillPaymentNormalizationSchema.safeParse(raw);
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
