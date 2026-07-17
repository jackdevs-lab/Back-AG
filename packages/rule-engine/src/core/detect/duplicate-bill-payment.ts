import { NormalizedDuplicateBillPayment } from '../normalize/duplicate-bill-payment';

/**
 * Pure detection logic for duplicate bill payments within a batch.
 */
export function detectDuplicateBillPayments(payments: NormalizedDuplicateBillPayment[]) {
    const groups = new Map<string, NormalizedDuplicateBillPayment[]>();

    for (const payment of payments) {
        const key = generateDuplicateKey(payment);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(payment);
    }

    return Array.from(groups.values())
        .filter(group => group.length > 1)
        .map(group => ({
            type: 'DUPLICATE_BILL_PAYMENT' as const,
            payments: group,
            fingerprint: group[0].qbId // Simple fingerprint for the group
        }));
}

function generateDuplicateKey(payment: NormalizedDuplicateBillPayment): string {
    const vendor = payment.vendorId || 'NO_VENDOR';
    const amount = payment.amount.abs().toFixed(2);
    const date = payment.date.toISOString().split('T')[0];
    const currency = payment.currency.toUpperCase();
    const refNumber = payment.refNumber || 'NO_REF';

    return `${vendor}|${amount}|${date}|${currency}|${refNumber}`;
}
