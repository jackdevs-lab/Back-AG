import { NormalizedTransaction } from '../normalize/expense-instead-of-bill-payment';
export function detectExpenseInsteadOfPayment(transactions: NormalizedTransaction[], windowMs: number) {
    const bills = transactions.filter(t => t.type === 'Bill');
    const purchases = transactions.filter(t => t.type === 'Purchase');

    const matches: { bill: NormalizedTransaction; purchase: NormalizedTransaction }[] = [];

    for (const bill of bills) {
        for (const purchase of purchases) {
            if (isMatch(bill, purchase, windowMs)) {
                matches.push({ bill, purchase });
            }
        }
    }

    return matches;
}

function isMatch(
    bill: NormalizedTransaction,
    purchase: NormalizedTransaction,
    windowMs: number
): boolean {
    if (bill.vendorId !== purchase.vendorId) return false;
    if (bill.currency !== purchase.currency) return false;
    if (Math.abs(bill.amount.toNumber() - purchase.amount.toNumber()) > 0.005) return false;

    const timeDiff = Math.abs(bill.date.getTime() - purchase.date.getTime());
    return timeDiff <= windowMs;
}
