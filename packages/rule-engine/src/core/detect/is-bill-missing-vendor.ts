// core/detect/is-bill-missing-vendor.ts

/**
 * Pure detection function: determines if a bill is missing vendor reference.
 * 
 * ZERO side effects:
 * - No database calls
 * - No logging
 * - No I/O operations
 * - No external dependencies
 * 
 * A bill violates the rule if:
 * 1. vendorId is null/missing (enforced at query level)
 * 2. status is 'Posted' or 'Paid' (enforced at query level)
 * 
 * This function exists for testability and potential pre-filtering use cases.
 */
export function isBillMissingVendor(bill: { vendorId: string | null; status: string }): boolean {
    // Core violation condition: no vendor AND active status
    // Note: Query-level filtering handles most of this; this is for pure logic testing
    const hasNoVendor = bill.vendorId === null || bill.vendorId === undefined;
    const isActive = ['Posted', 'Paid'].includes(bill.status);

    return hasNoVendor && isActive;
}

/**
 * Batch variant: filters array of bills using pure detection logic.
 * Useful for testing, validation, or client-side pre-filtering.
 */
export function filterBillsMissingVendor<T extends { vendorId: string | null; status: string }>(
    bills: T[]
): T[] {
    return bills.filter(bill => isBillMissingVendor(bill));
}
