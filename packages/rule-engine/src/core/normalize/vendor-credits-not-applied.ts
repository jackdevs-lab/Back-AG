// core/normalize/vendor-credits-not-applied.ts
import { Prisma } from '@qb-health/financial-model';
import { VendorCreditRawSchema } from '../shared/base-schemas';

interface RawVendorCredit {
    rawData?: any;
    qbId: string;
    vendorId: string;
    date: string;
    amount?: number;
}

export function normalizeCredit(raw: RawVendorCredit, homeCurrency: string) {
    if (!raw.qbId) throw new Error('Missing required field: qbId');
    if (!raw.vendorId) throw new Error('Missing required field: vendorId');
    if (!raw.date) throw new Error('Missing required field: date');
    if (!raw.rawData) throw new Error('Missing rawData property');

    const parsedRawResult = VendorCreditRawSchema.safeParse(raw.rawData);
    if (!parsedRawResult.success) {
        throw new Error(`Invalid rawData structure: ${parsedRawResult.error.message}`);
    }
    const parsedRaw = parsedRawResult.data;

    const dateParts = raw.date.split('T')[0].split('-');
    const dateObj = new Date(Date.UTC(+dateParts[0], +dateParts[1] - 1, +dateParts[2]));

    if (isNaN(dateObj.getTime())) {
        throw new Error(`Invalid date format: ${raw.date}`);
    }

    let balanceValue = 0;
    if (parsedRaw.Balance !== undefined) {
        balanceValue = Number(parsedRaw.Balance);
    } else if (raw.amount !== undefined) {
        balanceValue = Number(raw.amount);
    }
    if (isNaN(balanceValue)) throw new Error(`Invalid balance value`);

    const balance = new Prisma.Decimal(balanceValue);

    const currency = parsedRaw?.CurrencyRef?.value?.trim();
    const finalCurrency = currency || homeCurrency;

    if (!finalCurrency.trim()) throw new Error('Currency value cannot be empty');

    return {
        qbId: raw.qbId,
        vendorId: raw.vendorId,
        date: dateObj,
        unappliedBalance: balance,
        currency: finalCurrency
    };
}
