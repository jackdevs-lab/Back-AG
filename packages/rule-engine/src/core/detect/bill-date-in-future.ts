import { NormalizedBill, NormalizationResult } from '../normalize/bill-date-in-future';

function castToUTCDay(date: Date): number {
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isBillDateInFuture(
    billDate: Date,
    maxAllowedDate: Date
): boolean {
    validateDateInput(billDate, 'billDate');
    validateDateInput(maxAllowedDate, 'maxAllowedDate');

    return billDate.getTime() > maxAllowedDate.getTime();
}

export function isBillDateInFutureCalendarDay(
    billDate: Date,
    maxAllowedDate: Date
): boolean {
    validateDateInput(billDate, 'billDate');
    validateDateInput(maxAllowedDate, 'maxAllowedDate');

    const billDayUTC = castToUTCDay(billDate);
    const maxDayUTC = castToUTCDay(maxAllowedDate);

    return billDayUTC > maxDayUTC;
}

export function getDaysInFuture(
    billDate: Date,
    referenceDate: Date
): number {
    validateDateInput(billDate, 'billDate');
    validateDateInput(referenceDate, 'referenceDate');

    const billDayUTC = castToUTCDay(billDate);
    const refDayUTC = castToUTCDay(referenceDate);

    const diffMs = billDayUTC - refDayUTC;
    if (diffMs <= 0) return 0;

    return Math.floor(diffMs / 86400000);
}

function validateDateInput(value: unknown, paramName: string): void {
    if (!(value instanceof Date) || isNaN(value.getTime())) {
        throw new Error(`${paramName} must be a valid Date instance`);
    }
}

export function detectFutureDateBills(
    norm: NormalizationResult,
    now: Date = new Date()
): { bills: NormalizedBill[], snapshotTimestamp: string } {
    const bills = norm.bills.filter(b => isBillDateInFuture(b.date, now));
    return {
        bills,
        snapshotTimestamp: now.toISOString()
    };
}
