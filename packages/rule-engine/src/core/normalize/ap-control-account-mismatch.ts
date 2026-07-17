// core/normalize/ap-control-account-mismatch.ts
import { Prisma } from '@qb-health/financial-model';
import { JournalEntryRawSchema } from '../shared/base-schemas';

/**
 * Normalizes AP accounts and direct JEs for reconciliation.
 */
export function normalizeReconciliation(data: {
    billBalance: any;
    apAccounts: any[];
    journalEntries: any[];
}) {
    const glBalance = data.apAccounts.reduce(
        (sum, acc) => sum.add(new Prisma.Decimal(acc.balance || 0).abs()),
        new Prisma.Decimal(0)
    );

    const apAccountIds = new Set(data.apAccounts.map(a => a.qbId));

    // Forensic: Identify direct Journal Entries to AP account
    const directJEs = data.journalEntries.filter(je => {
        try {
            const raw = JournalEntryRawSchema.parse(je.rawData || {});
            return raw.Line?.some(l => apAccountIds.has(l.JournalEntryLineDetail?.AccountRef?.value || ''));
        } catch {
            return false;
        }
    }).map(je => ({
        id: je.qbId,
        date: je.date ? new Date(je.date).toLocaleDateString() : 'N/A',
        amount: new Prisma.Decimal(je.amount || 0).toFixed(2)
    }));

    return {
        billBalance: data.billBalance,
        glBalance,
        variance: data.billBalance.sub(glBalance).abs(),
        apAccounts: data.apAccounts,
        suspiciousJEs: directJEs
    };
}
