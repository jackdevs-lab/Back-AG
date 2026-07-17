// core/normalize/ar-control-account-mismatch.ts
import { Prisma } from '@qb-health/financial-model';
import { JournalEntryRawSchema } from '../shared/base-schemas';

/**
 * Normalizes AR sub-ledger sums and GL accounts for reconciliation.
 */
export function normalizeReconciliation(data: {
    customerStats: { sum: number; count: number };
    arAccounts: any[];
    journalEntries: any[];
    significantCustomers: any[];
}) {
    const subledgerSum = new Prisma.Decimal(data.customerStats.sum);
    
    const accountSum = data.arAccounts.reduce(
        (sum, acc) => sum.add(new Prisma.Decimal(acc.balance || 0)),
        new Prisma.Decimal(0)
    );

    const netVariance = subledgerSum.add(accountSum);
    const absVariance = netVariance.abs();

    const arAccountIds = new Set(data.arAccounts.map(a => a.qbId));

    // Forensic: Identify direct Journal Entries to AR account
    const suspiciousJEs = data.journalEntries.filter(je => {
        try {
            const raw = JournalEntryRawSchema.parse(je.rawData || {});
            return raw.Line?.some(l => arAccountIds.has(l.JournalEntryLineDetail?.AccountRef?.value || ''));
        } catch {
            return false;
        }
    }).map(je => ({
        id: je.qbId,
        date: je.date ? new Date(je.date).toLocaleDateString() : 'N/A',
        amount: new Prisma.Decimal(je.amount || 0).toFixed(2)
    }));

    return {
        subledgerSum,
        accountSum,
        absVariance,
        customerCount: data.customerStats.count,
        arAccounts: data.arAccounts,
        significantCustomers: data.significantCustomers,
        suspiciousJEs
    };
}
