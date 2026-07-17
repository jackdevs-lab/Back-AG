// core/normalize/je-without-name.ts
import { JournalEntryRawSchema } from '../shared/base-schemas';

/**
 * Normalizes a Journal Entry to extract line details and missing entities.
 * We specifically look for lines that ARE NOT using a Balance Sheet account 
 * (though in QBO, AP/AR require a name regardless).
 */
export function normalizeJournalEntry(raw: any) {
    const rawData = JournalEntryRawSchema.parse(raw.rawData || {});
    const lines = rawData.Line || [];

    const linesMissingName = lines
        .filter(l => l.DetailType === 'JournalEntryLineDetail')
        .filter(l => {
            const detail = l.JournalEntryLineDetail;
            const entityRef = detail?.Entity?.EntityRef;
            return !entityRef || !entityRef.value;
        })
        .map(l => ({
            amount: l.Amount,
            postingType: l.JournalEntryLineDetail?.PostingType,
            accountName: l.JournalEntryLineDetail?.AccountRef?.name
        }));

    return {
        qbId: raw.qbId,
        date: raw.date ? new Date(raw.date) : null,
        linesMissingName
    };
}
