import { NormalizedDuplicateVendorBill } from '../normalize/duplicate-vendor-bills';
export function detectDuplicateVendorBills(bills: NormalizedDuplicateVendorBill[]) {
    const groups = new Map<string, NormalizedDuplicateVendorBill[]>();

    for (const bill of bills) {
        if (!bill.docNumber) continue;

        const key = generateDuplicateKey(bill);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key)!.push(bill);
    }

    return Array.from(groups.values())
        .filter(group => group.length > 1)
        .map(group => ({
            type: 'DUPLICATE_VENDOR_BILL' as const,
            bills: group,
            fingerprint: group[0].qbId
        }));
}

function generateDuplicateKey(bill: NormalizedDuplicateVendorBill): string {
    const vendor = bill.vendorId || 'NO_VENDOR';
    const amount = bill.amount.abs().toFixed(2);
    const currency = bill.currency.toUpperCase();
    const docNumber = bill.docNumber!.trim().toUpperCase();

    return `${vendor}|${docNumber}|${amount}|${currency}`;
}
