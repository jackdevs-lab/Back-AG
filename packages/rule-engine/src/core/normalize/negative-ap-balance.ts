import { z } from 'zod';
import { safeDecimal } from '../shared/base-schemas';

const NegativeBalanceNormalizationSchema = z
    .preprocess(
        (raw) => raw ?? {},
        z
            .object({
                vendorId: z.union([z.string(), z.number()]).transform((val) => String(val)),
                vendorName: z.string().nullable().optional(),
                balance: safeDecimal,
            })
            .passthrough()
            .transform((data) => ({
                vendorId: data.vendorId,
                vendorName: data.vendorName || 'Unknown Vendor',
                balance: data.balance,
            }))
    );

export type NormalizedNegativeBalance = z.infer<typeof NegativeBalanceNormalizationSchema>;

export interface NormalizationResult {
    balances: NormalizedNegativeBalance[];
    unscannable: any[];
}

export function normalizeBalances(rawRecords: any[]): NormalizationResult {
    const balances: NormalizedNegativeBalance[] = [];
    const unscannable: any[] = [];

    rawRecords.forEach((raw) => {
        const result = NegativeBalanceNormalizationSchema.safeParse(raw);
        if (result.success) {
            balances.push(result.data);
        } else {
            unscannable.push({
                vendorId: (raw as any).vendorId || 'Unknown',
                issue: 'CRITICAL_DATA_MISSING',
                details: result.error.flatten(),
                rawRecord: raw
            });
        }
    });

    return { balances, unscannable };
}
