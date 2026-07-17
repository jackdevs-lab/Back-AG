import { NormalizedOrphanedBillPayment } from '../normalize/orphaned-bill-payment';

export function detectOrphanedBillPayments(
    payments: NormalizedOrphanedBillPayment[],
    existingBillIds: Set<string>
) {
    return payments.filter(payment => {
        if (payment.linkedBillIds.length === 0) return false;
        return payment.linkedBillIds.some(id => !existingBillIds.has(id));
    });
}
