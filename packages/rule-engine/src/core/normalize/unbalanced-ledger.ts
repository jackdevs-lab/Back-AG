// core/normalize/unbalanced-ledger.ts
import { Prisma } from '@qb-health/financial-model';
import { JournalEntryRawSchema } from '../shared/base-schemas';

/**
 * Normalizes a Journal Entry and its lines for balance reconciliation.
 */
export function normalizeJournalEntry(raw: any) {
    const rawData = JournalEntryRawSchema.parse(raw.rawData || {});
    const lines = rawData.Line || [];

    let debitTotal = new Prisma.Decimal(0);
    let creditTotal = new Prisma.Decimal(0);

    for (const line of lines) {
        if (line.DetailType === 'JournalEntryLineDetail') {
            const amount = new Prisma.Decimal(line.Amount || 0);
            const postingType = line.JournalEntryLineDetail?.PostingType;

            if (postingType === 'Debit') {
                debitTotal = debitTotal.add(amount);
            } else if (postingType === 'Credit') {
                creditTotal = creditTotal.add(amount);
            }
        }
    }

    return {
        qbId: raw.qbId,
        date: raw.date ? new Date(raw.date) : null,
        debitTotal,
        creditTotal,
        variance: debitTotal.sub(creditTotal).abs()
    };
}
