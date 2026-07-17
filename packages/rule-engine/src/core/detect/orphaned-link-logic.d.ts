import { Prisma } from '@qb-health/financial-model';
export interface OrphanedLink {
    paymentId: string;
    missingBillId: string;
    amount: Prisma.Decimal;
}
/**
 * Pure logic to identify orphaned bill payment references.
 * @param payments List of payments with their parsed lines.
 * @param existingBillIds Set of all valid Bill QBIDs in the current context.
 * @returns Array of orphaned links.
 */
export declare function detectOrphanedBillLinks(payments: Array<{
    qbId: string;
    parsedRaw: {
        Line?: Array<{
            Amount?: any;
            LinkedTxn?: Array<{
                TxnType?: string;
                TxnId?: string;
            }>;
        }>;
    } | null;
}>, existingBillIds: Set<string>): OrphanedLink[];
