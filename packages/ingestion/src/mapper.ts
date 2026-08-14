// packages/ingestion/src/mapper.ts
import { Prisma } from '@qb-health/financial-model';

// --- Domain Branded Types ---
export type Brand<K, T> = K & { __brand: T };
export type RealmId = Brand<string, 'RealmId'>;
export type QbId = Brand<string, 'QbId'>;
export type TenantId = Brand<string, 'TenantId'>;   // NEW
export type CompoundId = Brand<string, 'CompoundId'>;
export type RecordStatus = Brand<'Open' | 'Completed' | 'Void' | 'Paid' | 'Unmatched', 'RecordStatus'>;

export class Mapper {
    private generateId(realmId: RealmId, qbId: QbId | string): CompoundId {
        return `${realmId}-${qbId}` as CompoundId;
    }

    private generateOptionalId(realmId: RealmId, qbId?: QbId | string): CompoundId | undefined {
        if (!qbId) return undefined;
        return this.generateId(realmId, qbId);
    }

    private safeDate(dateValue: any): Date {
        if (!dateValue) return new Date();
        const parsed = new Date(dateValue);
        return isNaN(parsed.getTime()) ? new Date() : parsed;
    }

    private safeNumber(numValue: any): number {
        if (numValue === undefined || numValue === null) return 0;
        const parsed = Number(numValue);
        return isNaN(parsed) ? 0 : parsed;
    }

    mapAccount(
        qbAccount: any,
        realmId: RealmId,
        tenantId: TenantId,                   // NEW parameter
        syncSessionStartTime: Date
    ): Prisma.AccountCreateInput {
        return {
            id: this.generateId(realmId, qbAccount.Id),
            tenantId,                          // NEW field
            realmId,
            qbId: qbAccount.Id,
            name: qbAccount.Name || 'Unnamed Account',
            type: qbAccount.AccountType || 'Unknown',
            subType: qbAccount.AccountSubType || null,
            currency: qbAccount.CurrencyRef?.value || 'USD',
            active: qbAccount.Active ?? true,
            balance: this.safeNumber(qbAccount.CurrentBalance),
            updatedAt: this.safeDate(qbAccount.MetaData?.LastUpdatedTime),
            createdAt: this.safeDate(qbAccount.MetaData?.CreateTime),
            lastSyncedAt: syncSessionStartTime
        };
    }

    mapCustomer(
        qbCustomer: any,
        realmId: RealmId,
        tenantId: TenantId,                   // NEW parameter
        syncSessionStartTime: Date
    ): Prisma.CustomerCreateInput {
        return {
            id: this.generateId(realmId, qbCustomer.Id),
            tenantId,                          // NEW field
            realmId,
            qbId: qbCustomer.Id,
            name: qbCustomer.DisplayName || qbCustomer.CompanyName || 'Unknown Customer',
            email: qbCustomer.PrimaryEmailAddr?.Address || null,
            phone: qbCustomer.PrimaryPhone?.FreeFormNumber || null,
            active: qbCustomer.Active ?? true,
            balance: this.safeNumber(qbCustomer.Balance),
            updatedAt: this.safeDate(qbCustomer.MetaData?.LastUpdatedTime),
            createdAt: this.safeDate(qbCustomer.MetaData?.CreateTime),
            lastSyncedAt: syncSessionStartTime
        };
    }

    mapVendor(
        qbVendor: any,
        realmId: RealmId,
        tenantId: TenantId,                   // NEW parameter
        syncSessionStartTime: Date
    ): Prisma.VendorCreateInput {
        return {
            id: this.generateId(realmId, qbVendor.Id),
            tenantId,                          // NEW field
            realmId,
            qbId: qbVendor.Id,
            name: qbVendor.DisplayName || qbVendor.CompanyName || 'Unknown Vendor',
            email: qbVendor.PrimaryEmailAddr?.Address || null,
            active: qbVendor.Active ?? true,
            updatedAt: this.safeDate(qbVendor.MetaData?.LastUpdatedTime),
            createdAt: this.safeDate(qbVendor.MetaData?.CreateTime),
            lastSyncedAt: syncSessionStartTime
        };
    }

    mapTransaction(
        qbTransaction: any,
        realmId: RealmId,
        tenantId: TenantId,                   // NEW parameter
        type: string,
        syncSessionStartTime: Date
    ): Prisma.TransactionCreateInput {
        const lines = Array.isArray(qbTransaction.Line) ? qbTransaction.Line : [];
        let rawCategoryId: string | undefined = qbTransaction.DepartmentRef?.value;
        let isReconciled = false;

        if (!rawCategoryId && lines.length > 0) {
            for (const line of lines) {
                const status = line.Entity?.ClearedStatus?.toLowerCase();
                if (status === 'cleared' || status === 'reconciled') {
                    isReconciled = true;
                }

                if (line.DetailType === 'SalesItemLineDetail') {
                    rawCategoryId = line.SalesItemLineDetail?.ItemRef?.value;
                } else if (line.DetailType === 'AccountBasedExpenseLineDetail') {
                    rawCategoryId = line.AccountBasedExpenseLineDetail?.AccountRef?.value;
                } else if (line.DetailType === 'JournalEntryLineDetail') {
                    rawCategoryId = line.JournalEntryLineDetail?.AccountRef?.value;
                } else if (line.DetailType === 'ItemBasedExpenseLineDetail') {
                    rawCategoryId = line.ItemBasedExpenseLineDetail?.ItemRef?.value;
                } else if (line.DetailType === 'DepositLineDetail') {
                    rawCategoryId = line.DepositLineDetail?.AccountRef?.value;
                }

                if (rawCategoryId && isReconciled) break;
            }
        }

        const totalAmt = qbTransaction.TotalAmt !== undefined ? this.safeNumber(qbTransaction.TotalAmt) : null;
        const amountProp = qbTransaction.Amount !== undefined ? this.safeNumber(qbTransaction.Amount) : null;
        const balanceProp = qbTransaction.Balance !== undefined ? this.safeNumber(qbTransaction.Balance) : null;
        const unappliedAmt = qbTransaction.UnappliedAmt !== undefined ? this.safeNumber(qbTransaction.UnappliedAmt) : null;
        const finalAmount = totalAmt ?? amountProp ?? balanceProp ?? 0;

        // Case-Insensitive Status Calculation
        let calculatedStatus: RecordStatus = 'Completed' as RecordStatus;
        const rawStatus = (qbTransaction.Status || '').toLowerCase();
        const privateNote = (qbTransaction.PrivateNote || '').toLowerCase();
        const firstLineDetail = (lines[0]?.DetailType || '').toLowerCase();

        if (rawStatus === 'voided' || privateNote.includes('void') || firstLineDetail === 'void') {
            calculatedStatus = 'Void' as RecordStatus;
        } else if (type === 'Payment') {
            calculatedStatus = (unappliedAmt !== null && unappliedAmt > 0) ? ('Open' as RecordStatus) : ('Completed' as RecordStatus);
        } else if (balanceProp !== null) {
            calculatedStatus = (balanceProp === 0) ? ('Paid' as RecordStatus) : ('Open' as RecordStatus);
        } else if (type === 'Bill' || type === 'Invoice') {
            calculatedStatus = 'Open' as RecordStatus;
        }

        // Generate Compound Foreign Keys to prevent FK Constraint Violations
        const rawVendorQbId = (type === 'Bill' && qbTransaction.VendorRef?.value)
            ? qbTransaction.VendorRef.value
            : (qbTransaction.VendorRef?.value || qbTransaction.EntityRef?.value);

        return {
            id: this.generateId(realmId, qbTransaction.Id),
            tenantId,                          // NEW field
            realmId,
            qbId: qbTransaction.Id,
            type,
            date: this.safeDate(qbTransaction.TxnDate || qbTransaction.MetaData?.CreateTime),
            amount: new Prisma.Decimal(finalAmount),
            status: calculatedStatus,
            categoryId: rawCategoryId ? rawCategoryId : null,
            customerId: this.generateOptionalId(realmId, qbTransaction.CustomerRef?.value) || null,
            vendorId: this.generateOptionalId(realmId, rawVendorQbId) || null,
            isReconciled,
            rawData: qbTransaction as Prisma.InputJsonValue,
            syncToken: parseInt(qbTransaction.SyncToken, 10) || 0,
            updatedAt: this.safeDate(qbTransaction.MetaData?.LastUpdatedTime),
            createdAt: this.safeDate(qbTransaction.MetaData?.CreateTime),
            lastSyncedAt: syncSessionStartTime
        };
    }

    mapToUnifiedBankTransaction(
        qbRecord: any,
        entityType: string,
        realmId: RealmId,
        tenantId: TenantId,                   // NEW parameter
        syncSessionStartTime: Date
    ): Prisma.BankTransactionCreateInput {
        let rawAccountId: string | undefined;
        let amount = qbRecord.Amount ?? qbRecord.TotalAmt ?? 0;
        let description = qbRecord.PrivateNote || qbRecord.Name || 'Bank Activity';
        let payee = qbRecord.EntityRef?.name || null;

        switch (entityType) {
            case 'Deposit':
                rawAccountId = qbRecord.DepositToAccountRef?.value;
                description = qbRecord.PrivateNote || 'Deposit';
                break;
            case 'Purchase':
                rawAccountId = qbRecord.AccountRef?.value;
                description = qbRecord.PrivateNote || 'Expense/Purchase';
                break;
            case 'Transfer':
                rawAccountId = qbRecord.FromAccountRef?.value;
                amount = qbRecord.Amount;
                description = qbRecord.PrivateNote || 'Transfer';
                break;
            case 'JournalEntry':
                rawAccountId = qbRecord.Line?.[0]?.JournalEntryLineDetail?.AccountRef?.value;
                amount = qbRecord.Line?.[0]?.Amount || 0;
                description = qbRecord.PrivateNote || qbRecord.Line?.[0]?.Description || 'Journal Entry';
                break;
        }

        if (!rawAccountId && Array.isArray(qbRecord.Line) && qbRecord.Line.length > 0) {
            for (const line of qbRecord.Line) {
                rawAccountId = line.AccountBasedExpenseLineDetail?.AccountRef?.value ||
                    line.JournalEntryLineDetail?.AccountRef?.value ||
                    line.DepositLineDetail?.AccountRef?.value;
                if (rawAccountId) break;
            }
        }

        // Ensure target account uses Compound ID for Foreign Key alignment
        const targetAccountId = rawAccountId
            ? this.generateId(realmId, rawAccountId)
            : this.generateId(realmId, 'UNKNOWN_ACCOUNT');

        return {
            id: this.generateId(realmId, qbRecord.Id),
            tenantId,                          // NEW field
            realmId,
            qbId: qbRecord.Id,
            accountId: targetAccountId,
            date: this.safeDate(qbRecord.TxnDate || qbRecord.MetaData?.CreateTime),
            amount: new Prisma.Decimal(this.safeNumber(amount)),
            description,
            payee,
            status: (qbRecord.Status || 'Unmatched') as RecordStatus,
            rawData: qbRecord as Prisma.InputJsonValue,
            updatedAt: this.safeDate(qbRecord.MetaData?.LastUpdatedTime),
            createdAt: this.safeDate(qbRecord.MetaData?.CreateTime),
            lastSyncedAt: syncSessionStartTime
        };
    }
}