// core/normalize/broken-transaction-link.ts
import { InvoiceRawSchema } from '../shared/base-schemas';

/**
 * Extracts internal links from a transaction's raw data.
 */
export function normalizeLinks(txn: any) {
    const rawData = InvoiceRawSchema.parse(txn.rawData || {});
    const rootLinks = rawData.LinkedTxn || [];
    const lineLinks = (rawData.Line || []).flatMap((l: any) => l.LinkedTxn || []);

    const allLinks = (rootLinks as any[]).concat(lineLinks as any[])
        .filter((l: any) => l.TxnId)
        .map((l: any) => ({
            targetId: l.TxnId,
            targetType: l.TxnType
        }));

    return {
        qbId: txn.qbId,
        type: txn.type,
        date: txn.date ? new Date(txn.date) : null,
        links: allLinks
    };
}
