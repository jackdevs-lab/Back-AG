import { NormalizedBillPayment } from '../normalize/bill-payment-without-bill';

export type BillLinkStatus = 'linked' | 'unlinked' | 'unknown';

/**
 * Pure detection logic for unlinked bill payments.
 */
export function detectUnlinkedPayments(payments: NormalizedBillPayment[]) {
    return payments.filter(p => lacksBillLink(p.parsedRaw) === 'unlinked');
}

export function lacksBillLink(parsedRaw: any): BillLinkStatus {
    if (!parsedRaw || typeof parsedRaw !== 'object') return 'unknown';

    if (!Array.isArray(parsedRaw.Line)) return 'unknown';

    for (const line of parsedRaw.Line) {
        if (!line || typeof line !== 'object') continue;

        if (!Array.isArray(line.LinkedTxn)) continue;

        const hasBillLink = line.LinkedTxn.some((link: any) =>
            link?.TxnType?.toLowerCase() === 'bill'
        );

        if (hasBillLink) return 'linked';
    }

    return 'unlinked';
}
