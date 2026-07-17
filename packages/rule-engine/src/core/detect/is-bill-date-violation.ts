// core/detect/is-bill-date-violation.ts

/**
 * Pure detection function: determines if a bill violates the future-date rule.
 * 
 * ZERO side effects:
 * - No database calls
 * - No logging
 * - No I/O operations
 * - No external dependencies
 * 
 * Input: primitive values and simple objects only
 * Output: boolean determination
 */
export function isBillDateViolation(
    billDate: Date,
    maxAllowedUTC: Date,
    status: string
): boolean {
    // Violation conditions:
    // 1. Bill date is at or after the maximum allowed threshold
    // 2. Bill status is active (not Void or Deleted)

    const isFutureDated = billDate >= maxAllowedUTC;
    const isActive = !['Void', 'Deleted'].includes(status);

    return isFutureDated && isActive;
}

/**
 * Batch variant: filters array of bills using pure detection logic.
 * Useful for pre-filtering or validation outside the main rule flow.
 */
export function filterViolations<T extends { date: Date; status: string }>(
    bills: T[],
    maxAllowedUTC: Date
): T[] {
    return bills.filter(bill =>
        isBillDateViolation(bill.date, maxAllowedUTC, bill.status)
    );
}
