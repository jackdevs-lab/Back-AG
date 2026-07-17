// packages/ingestion/src/mapper.ts
import { Prisma } from '@qb-health/financial-model';

// --- Domain Branded Types ---
export type Brand<K, T> = K & { __brand: T };
export type RealmId = Brand<string, 'RealmId'>;
export type QbId = Brand<string, 'QbId'>;
export type CompoundId = Brand<string, 'CompoundId'>;
export type RecordStatus = Brand<'Open' | 'Completed' | 'Void' | 'Paid' | 'Unmatched', 'RecordStatus'>;

export class Mapper {

    private generateId(realmId: RealmId, qbId: QbId | string): CompoundId {
        return `${realmId}-${qbId}` as CompoundId;
    }

    mapAccount(qbAccount: any, realmId: RealmId): Prisma.AccountCreateInput {
        return {
            id: this.generateId(realmId, qbAccount.Id),
            realmId,
            qbId: qbAccount.Id,
            name: qbAccount.Name,
            type: qbAccount.AccountType,
            subType: qbAccount.AccountSubType,
            currency: qbAccount.CurrencyRef?.value || 'USD',
            active: qbAccount.Active ?? true,
            balance: qbAccount.CurrentBalance || 0,
            updatedAt: new Date(qbAccount.MetaData?.LastUpdatedTime || Date.now()),
            createdAt: new Date(qbAccount.MetaData?.CreateTime || Date.now())
        };
    }

    mapCustomer(qbCustomer: any, realmId: RealmId): Prisma.CustomerCreateInput {
        return {
            id: this.generateId(realmId, qbCustomer.Id),
            realmId,
            qbId: qbCustomer.Id,
            name: qbCustomer.DisplayName,
            email: qbCustomer.PrimaryEmailAddr?.Address,
            phone: qbCustomer.PrimaryPhone?.FreeFormNumber,
            active: qbCustomer.Active ?? true,
            balance: qbCustomer.Balance || 0,
            updatedAt: new Date(qbCustomer.MetaData?.LastUpdatedTime || Date.now()),
            createdAt: new Date(qbCustomer.MetaData?.CreateTime || Date.now())
        };
    }

    mapVendor(qbVendor: any, realmId: RealmId): Prisma.VendorCreateInput {
        return {
            id: this.generateId(realmId, qbVendor.Id),
            realmId,
            qbId: qbVendor.Id,
            name: qbVendor.DisplayName,
            email: qbVendor.PrimaryEmailAddr?.Address,
            active: qbVendor.Active ?? true,
            updatedAt: new Date(qbVendor.MetaData?.LastUpdatedTime || Date.now()),
            createdAt: new Date(qbVendor.MetaData?.CreateTime || Date.now())
        };
    }

    mapTransaction(qbTransaction: any, realmId: RealmId, type: string): Prisma.TransactionCreateInput {
        const lines = qbTransaction.Line || [];
        let categoryId = qbTransaction.DepartmentRef?.value;
        let isReconciled = false;

        if (!categoryId && lines.length > 0) {
            for (const line of lines) {
                if (line.Entity?.ClearedStatus === 'Cleared' || line.Entity?.ClearedStatus === 'Reconciled') {
                    isReconciled = true;
                }

                if (line.DetailType === 'SalesItemLineDetail') {
                    categoryId = line.SalesItemLineDetail.ItemRef?.value;
                } else if (line.DetailType === 'AccountBasedExpenseLineDetail') {
                    categoryId = line.AccountBasedExpenseLineDetail.AccountRef?.value;
                } else if (line.DetailType === 'JournalEntryLineDetail') {
                    categoryId = line.JournalEntryLineDetail.AccountRef?.value;
                } else if (line.DetailType === 'ItemBasedExpenseLineDetail') {
                    categoryId = line.ItemBasedExpenseLineDetail.ItemRef?.value;
                } else if (line.DetailType === 'DepositLineDetail') {
                    categoryId = line.DepositLineDetail.AccountRef?.value;
                }

                if (categoryId && isReconciled) break;
            }
        }

        const totalAmt = qbTransaction.TotalAmt !== undefined ? Number(qbTransaction.TotalAmt) : null;
        const amountProp = qbTransaction.Amount !== undefined ? Number(qbTransaction.Amount) : null;
        const balanceProp = qbTransaction.Balance !== undefined ? Number(qbTransaction.Balance) : null;
        const unappliedAmt = qbTransaction.UnappliedAmt !== undefined ? Number(qbTransaction.UnappliedAmt) : null;
        const finalAmount = totalAmt ?? amountProp ?? balanceProp ?? 0;

        let calculatedStatus: string = 'Completed';

        if (
            qbTransaction.Status === 'Voided' ||
            qbTransaction.PrivateNote?.includes('Void') ||
            lines[0]?.DetailType === 'Void'
        ) {
            calculatedStatus = 'Void';
        } else if (type === 'Payment') {
            calculatedStatus = unappliedAmt !== null && unappliedAmt > 0 ? 'Open' : 'Completed';
        } else if (balanceProp !== null) {
            calculatedStatus = balanceProp === 0 ? 'Paid' : 'Open';
        } else if (type === 'Bill' || type === 'Invoice') {
            calculatedStatus = 'Open';
        }

        return {
            id: this.generateId(realmId, qbTransaction.Id),
            realmId,
            qbId: qbTransaction.Id,
            type,
            date: new Date(qbTransaction.TxnDate || qbTransaction.MetaData?.CreateTime || Date.now()),
            amount: new Prisma.Decimal(finalAmount),
            status: calculatedStatus as RecordStatus,
            categoryId,
            customerId: qbTransaction.CustomerRef?.value,
            vendorId: (type === 'Bill' && qbTransaction.VendorRef?.value)
                ? qbTransaction.VendorRef.value
                : (qbTransaction.VendorRef?.value || qbTransaction.EntityRef?.value),
            isReconciled,
            rawData: qbTransaction as Prisma.InputJsonValue,
            syncToken: parseInt(qbTransaction.SyncToken) || 0,
            updatedAt: new Date(qbTransaction.MetaData?.LastUpdatedTime || Date.now()),
            createdAt: new Date(qbTransaction.MetaData?.CreateTime || Date.now())
        };
    }

    mapToUnifiedBankTransaction(qbRecord: any, entityType: string, realmId: RealmId): Prisma.BankTransactionCreateInput {
        let accountId: string | undefined;
        let amount = qbRecord.Amount || qbRecord.TotalAmt || 0;
        let description = qbRecord.PrivateNote || qbRecord.Name || 'Bank Activity';
        let payee = qbRecord.EntityRef?.name;

        switch (entityType) {
            case 'Deposit':
                accountId = qbRecord.DepositToAccountRef?.value;
                description = qbRecord.PrivateNote || 'Deposit';
                break;
            case 'Purchase':
                accountId = qbRecord.AccountRef?.value;
                description = qbRecord.PrivateNote || 'Expense/Purchase';
                break;
            case 'Transfer':
                accountId = qbRecord.FromAccountRef?.value;
                amount = qbRecord.Amount;
                description = qbRecord.PrivateNote || 'Transfer';
                break;
            case 'JournalEntry':
                accountId = qbRecord.Line?.[0]?.JournalEntryLineDetail?.AccountRef?.value;
                amount = qbRecord.Line?.[0]?.Amount || 0;
                description = qbRecord.PrivateNote || qbRecord.Line?.[0]?.Description || 'Journal Entry';
                break;
        }

        if (!accountId && qbRecord.Line && qbRecord.Line.length > 0) {
            for (const line of qbRecord.Line) {
                accountId = line.AccountBasedExpenseLineDetail?.AccountRef?.value ||
                    line.JournalEntryLineDetail?.AccountRef?.value ||
                    line.DepositLineDetail?.AccountRef?.value;
                if (accountId) break;
            }
        }

        return {
            id: this.generateId(realmId, qbRecord.Id),
            realmId,
            qbId: qbRecord.Id,
            accountId: accountId || 'UNKNOWN_ACCOUNT',
            date: new Date(qbRecord.TxnDate || qbRecord.MetaData?.CreateTime || Date.now()),
            amount: new Prisma.Decimal(Number(amount) || 0),
            description,
            payee,
            status: (qbRecord.Status || 'Unmatched') as RecordStatus,
            rawData: qbRecord as Prisma.InputJsonValue,
            updatedAt: new Date(qbRecord.MetaData?.LastUpdatedTime || Date.now()),
            createdAt: new Date(qbRecord.MetaData?.CreateTime || Date.now())
        };

    }
}