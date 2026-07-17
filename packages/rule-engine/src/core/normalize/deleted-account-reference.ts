// core/normalize/deleted-account-reference.ts
import { JournalEntryRawSchema } from '../shared/base-schemas';

/**
 * Normalizes a transaction to extract all account IDs referenced in its lines.
 */
export function normalizeAccountRefs(txn: any) {
    const rawData = JournalEntryRawSchema.parse(txn.rawData || {});
    const lines = rawData.Line || [];

    const refs = lines.map(line => ({
        accountId: extractAccountId(line),
        detailType: line.DetailType || 'Unknown'
    })).filter(r => r.accountId);

    return {
        qbId: txn.qbId,
        type: txn.type,
        date: txn.date ? new Date(txn.date) : null,
        refs
    };
}

function extractAccountId(line: any): string | null {
    switch (line.DetailType) {
        case 'AccountBasedExpenseLineDetail':
            return line.AccountBasedExpenseLineDetail?.AccountRef?.value || null;
        case 'JournalEntryLineDetail':
            return line.JournalEntryLineDetail?.AccountRef?.value || null;
        case 'DepositLineDetail':
            return line.DepositLineDetail?.AccountRef?.value || null;
        default:
            return null;
    }
}
