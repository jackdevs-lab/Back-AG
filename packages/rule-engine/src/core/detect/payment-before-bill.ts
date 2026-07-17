import { NormalizedTransaction } from '../normalize/payment-before-bill';

export function detectPaymentBeforeBill(
    payments: NormalizedTransaction[],
    bills: Map<string, NormalizedTransaction>
) {
    const anomalies: { payment: NormalizedTransaction; bill: NormalizedTransaction }[] = [];

    for (const payment of payments) {
        if (payment.type !== 'BillPayment') continue;

        const linkedBillIds = getLinkedBillIds(payment.parsedRaw);
        for (const billId of linkedBillIds) {
            const bill = bills.get(billId);
            if (bill && isBefore(payment.date, bill.date)) {
                anomalies.push({ payment, bill });
            }
        }
    }

    return anomalies;
}

function getLinkedBillIds(parsedRaw: any): string[] {
    const ids = new Set<string>();
    if (parsedRaw?.Line) {
        const lines = Array.isArray(parsedRaw.Line) ? parsedRaw.Line : [parsedRaw.Line];
        for (const line of lines) {
            const links = Array.isArray(line.LinkedTxn) ? line.LinkedTxn : [line.LinkedTxn];
            for (const link of links) {
                if (link?.TxnType === 'Bill' && link?.TxnId) {
                    ids.add(String(link.TxnId));
                }
            }
        }
    }
    return Array.from(ids);
}

function isBefore(paymentDate: Date, billDate: Date): boolean {
    return paymentDate.getTime() < billDate.getTime();
}
