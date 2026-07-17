// core/detect/duplicate-logic.ts
import { Prisma } from '@qb-health/financial-model';

export interface DuplicateGroup<T> {
    key: string;
    items: T[];
}

/**
 * Higher-order function to identify duplicate groups based on a derived key.
 * Pure logic: No DB/IO.
 */
export function identifyDuplicates<T>(
    items: T[],
    keyFn: (item: T) => string
): DuplicateGroup<T>[] {
    const groups = new Map<string, T[]>();

    for (const item of items) {
        const key = keyFn(item);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(item);
    }

    return Array.from(groups.entries())
        .filter(([_, groupItems]) => groupItems.length > 1)
        .map(([key, groupItems]) => ({ key, items: groupItems }));
}

/**
 * Standard key generator for Bill duplicates.
 */
export function generateBillDuplicateKey(params: {
    vendorId: string | null;
    amount: Prisma.Decimal;
    dateKey: string;
    currency: string;
    docNumber: string;
}): string {
    const { vendorId, amount, dateKey, currency, docNumber } = params;
    const vendor = vendorId || 'NoVendor';
    const amountStr = amount.toFixed(2);
    const ref = docNumber.trim().toLowerCase();
    
    return `${vendor}|${amountStr}|${dateKey}|${currency}|${ref}`;
}

/**
 * Standard key generator for Bill Payment duplicates.
 */
export function generateBillPaymentDuplicateKey(params: {
    vendorId: string | null;
    amount: Prisma.Decimal;
    dateKey: string;
    currency: string;
    refKey: string;
    linkedTxnIds: string[];
}): string {
    const { vendorId, amount, dateKey, currency, refKey, linkedTxnIds } = params;
    const vendor = vendorId || 'NoVendor';
    const amountStr = amount.toFixed(2);
    const linkedStr = linkedTxnIds.sort().join(',');
    
    return `${vendor}|${amountStr}|${dateKey}|${currency}|${refKey}|${linkedStr}`;
}
