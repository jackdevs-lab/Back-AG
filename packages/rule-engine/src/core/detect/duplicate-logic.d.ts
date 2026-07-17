import { Prisma } from '@qb-health/financial-model';
export interface DuplicateGroup<T> {
    key: string;
    items: T[];
}
/**
 * Higher-order function to identify duplicate groups based on a derived key.
 * Pure logic: No DB/IO.
 */
export declare function identifyDuplicates<T>(items: T[], keyFn: (item: T) => string): DuplicateGroup<T>[];
/**
 * Standard key generator for Bill duplicates.
 */
export declare function generateBillDuplicateKey(params: {
    vendorId: string | null;
    amount: Prisma.Decimal;
    dateKey: string;
    currency: string;
    docNumber: string;
}): string;
/**
 * Standard key generator for Bill Payment duplicates.
 */
export declare function generateBillPaymentDuplicateKey(params: {
    vendorId: string | null;
    amount: Prisma.Decimal;
    dateKey: string;
    currency: string;
    refKey: string;
    linkedTxnIds: string[];
}): string;
