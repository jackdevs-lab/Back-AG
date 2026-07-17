// core/detect/orphaned-link-logic.ts
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
export function detectOrphanedBillLinks(
    payments: Array<{
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
    }>,
    existingBillIds: Set<string>
): OrphanedLink[] {
    const orphaned: OrphanedLink[] = [];

    for (const payment of payments) {
        const raw = payment.parsedRaw;
        if (!raw || !raw.Line) continue;

        for (const line of raw.Line) {
            if (!line.LinkedTxn) continue;

            for (const link of line.LinkedTxn) {
                if (
                    link.TxnType === 'Bill' && 
                    link.TxnId && 
                    !existingBillIds.has(link.TxnId)
                ) {
                    orphaned.push({
                        paymentId: payment.qbId,
                        missingBillId: link.TxnId,
                        amount: new Prisma.Decimal(line.Amount || 0)
                    });
                }
            }
        }
    }

    return orphaned;
}
