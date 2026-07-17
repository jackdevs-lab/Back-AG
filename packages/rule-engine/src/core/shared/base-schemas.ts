import { z } from 'zod';
import { Prisma } from '@qb-health/financial-model';

export const safeDecimal = z
    .union([z.number(), z.string()])
    .transform((val) => {
        try {
            return new Prisma.Decimal(val);
        } catch {
            throw new Error(`Invalid amount value: ${val}`);
        }
    });

export const safeDate = z
    .union([z.string(), z.number(), z.date()])
    .transform((val) => {
        try {
            const date = new Date(val);
            if (Number.isNaN(date.getTime())) {
                throw new Error(`Invalid date value: ${val}`);
            }
            return date;
        } catch {
            throw new Error(`Invalid date value: ${val}`);
        }
    });


export const LinkedTxnSchema = z.object({
    TxnId: z.string().optional(),
    TxnType: z.string().optional()
});

export const QboRefSchema = z.object({
    value: z.string().optional(),
    name: z.string().optional()
});


export const BillRawSchema = z.object({
    DocNumber: z.string().optional(),
    CurrencyRef: QboRefSchema.optional(),
    VendorRef: QboRefSchema.optional(),
    CustomerRef: QboRefSchema.optional(),
    DueDate: z.string().optional(),
    Balance: z.number().optional(),
    MetaData: z.object({
        LastUpdatedTime: z.string().optional()
    }).optional(),
    Line: z.array(z.object({
        Amount: z.any().optional(),
        LinkedTxn: z.array(LinkedTxnSchema).optional()
    }).passthrough()).optional()
}).passthrough();

export const InvoiceRawSchema = BillRawSchema;


export const BillPaymentRawSchema = z.object({
    CurrencyRef: QboRefSchema.optional(),
    VendorRef: QboRefSchema.optional(),
    CustomerRef: QboRefSchema.optional(),
    TotalAmt: z.number().optional(),
    // UnappliedAmt is the authoritative QBO field for the unlinked portion of a payment.
    // Present on Customer Payments when TotalAmt > sum of applied Lines.
    UnappliedAmt: z.number().optional(),
    PaymentRefNum: z.string().optional(),
    Line: z.array(z.object({
        LinkedTxn: z.array(LinkedTxnSchema).optional()
    }).passthrough()).optional()
}).passthrough();

export const PaymentRawSchema = BillPaymentRawSchema;

export const VendorCreditRawSchema = z.object({
    Balance: z.number().optional(),
    CurrencyRef: QboRefSchema.optional(),
    VendorRef: QboRefSchema.optional(),
    CustomerRef: QboRefSchema.optional()
}).passthrough();

export const CreditMemoRawSchema = VendorCreditRawSchema;

export const JournalEntryRawSchema = z.object({
    DocNumber: z.string().optional(),
    Line: z.array(z.object({
        DetailType: z.string().optional(),
        Amount: z.any().optional(),
        JournalEntryLineDetail: z.object({
            PostingType: z.enum(['Debit', 'Credit']).optional(),
            AccountRef: QboRefSchema.optional(),
            Entity: z.object({
                Type: z.string().optional(),
                EntityRef: QboRefSchema.optional()
            }).optional()
        }).optional()
    }).passthrough()).optional()
}).passthrough();

export const AccountRawSchema = z.object({
    Name: z.string().optional(),
    AccountType: z.string().optional(),
    AccountSubType: z.string().optional(),
    Active: z.boolean().optional(),
    CurrentBalance: z.number().optional()
}).passthrough();

export const DepositRawSchema = z.object({
    TxnDate: z.string().optional(),
    TotalAmt: z.number().optional(),
    CurrencyRef: QboRefSchema.optional(),
    DepositToAccountRef: QboRefSchema.optional(),
    EntityRef: QboRefSchema.optional(),
    PaymentMethodRef: QboRefSchema.optional(),
    PrivateNote: z.string().optional().default(''),
    SyncToken: z.any().optional(),
    Line: z.array(z.object({
        Amount: z.any().optional(),
        DepositLineDetail: z.object({
            Entity: QboRefSchema.optional(),
            AccountRef: QboRefSchema.optional()
        }).optional(),
        LinkedTxn: z.array(LinkedTxnSchema).optional()
    }).passthrough()).optional()
}).passthrough();

export const PurchaseRawSchema = z.object({
    PaymentType: z.string().optional(),
    PrintStatus: z.string().optional(),
    EntityRef: QboRefSchema.optional(),
    AccountRef: QboRefSchema.optional(),
    CheckDetail: z.any().optional(),
    Line: z.array(z.object({
        Amount: z.any().optional(),
        AccountBasedExpenseLineDetail: z.object({
            AccountRef: QboRefSchema.optional()
        }).optional()
    }).passthrough()).optional()
}).passthrough();
export const EnrichedFindingSchema = z.object({
    id: z.string(),
    label: z.string(),
    date: safeDate,
    amount: safeDecimal,
    currency: z.string().default('USD'),
    metadata: z.record(z.string(), z.any()).optional(),
    entities: z.array(z.any()).optional(),
});

export type EnrichedFinding = z.infer<typeof EnrichedFindingSchema>;
