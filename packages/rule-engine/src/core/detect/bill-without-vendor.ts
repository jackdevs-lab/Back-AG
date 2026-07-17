import { NormalizedBill } from '../normalize/bill-without-vendor';

/**
 * Pure detection logic for bills without vendors.
 */
export function detectBillsWithoutVendor(bills: NormalizedBill[]) {
    return bills.filter(bill => lacksVendor(bill.vendorId));
}

export function lacksVendor(vendorId: string | null): boolean {
    if (vendorId === null) {
        return true;
    }

    const normalized = vendorId.trim();
    return normalized === '' || normalized === 'NoVendor';
}
