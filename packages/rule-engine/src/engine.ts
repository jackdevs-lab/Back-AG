// packages/rule-engine/src/engine.ts
import { prisma, PrismaBrandedRepository, RealmId, QbConnectionId } from '@qb-health/financial-model';
import { createLogger, Logger } from '@qb-health/utils';
import { ruleRegistry } from './registry';
import { IRule, RuleContext, Issue, RuleExecutionResult, HardenedPrisma } from './types';

// The generated PrismaClient satisfies HardenedPrisma at runtime;
// cast once here rather than in every call-site.
const hardenedPrisma = prisma as unknown as HardenedPrisma;

// Hygiene Rules
import { UnappliedPaymentsRule } from './rules/hygiene/unapplied-payments';
// DISABLED - Not in current priority list
// import { DuplicateCustomersRule } from './rules/hygiene/duplicate-customers';
// DISABLED - Not in current priority list
// import { UncategorizedTransactionsRule } from './rules/hygiene/uncategorized-transactions';
// DISABLED - Not in current priority list
// import { DuplicateVendorsRule } from './rules/hygiene/duplicate-vendors';
// DISABLED - Not in current priority list
// import { TransactionWithoutMemoRule } from './rules/hygiene/transaction-without-memo';
// DISABLED - Not in current priority list
// import { SuspiciousRoundNumberTransactionRule } from './rules/hygiene/suspicious-round-number-transaction';
// DISABLED - Not in current priority list
// import { ExpenseWithoutVendorRule } from './rules/hygiene/expense-without-vendor';
// DISABLED - Not in current priority list
// import { LargeTransactionOutlierRule } from './rules/hygiene/large-transaction-outlier';
// DISABLED - Not in current priority list
// import { HighJournalEntryUsageRule } from './rules/hygiene/high-journal-entry-usage';
// DISABLED - Not in current priority list
// import { InactiveCustomerBalanceRule } from './rules/hygiene/inactive-customer-balance';

// Balance Rules
// DISABLED - Not in current priority list
// import { UnbalancedLedgerRule } from './rules/balance/unbalanced-ledger';
import { ArControlAccountMismatchRule } from './rules/balance/ar-control-account-mismatch';
import { ApControlAccountMismatchRule } from './rules/balance/ap-control-account-mismatch';
// DISABLED - Not in current priority list
// import { JEWithoutNameRule } from './rules/balance/je-without-name';
import { DeletedAccountReferenceRule } from './rules/balance/deleted-account-reference';
import { BrokenTransactionLinkRule } from './rules/balance/broken-transaction-link';
import { OrphanedPaymentRule } from './rules/ar/orphaned-payment';
import { OrphanedBillPaymentRule } from './rules/ap/orphaned-bill-payment';

// Banking Rules
import { IncorrectDepositRecordingRule } from './rules/banking/incorrect-deposit-recording';
// DISABLED - Not in current priority list
// import { UndepositedFundsGroupRule } from './rules/banking/undeposited-funds-grouping';
import { DuplicateDepositsRule } from './rules/banking/duplicate-deposits';
// DISABLED - Not in current priority list
// import { DepositWithoutCustomerRule } from './rules/banking/deposit-without-customer';
// DISABLED - Not in current priority list
// import { OrphanedDepositLineRule } from './rules/banking/orphaned-deposit-line';
import { UndepositedFundsAgingRule } from './rules/banking/undeposited-funds-aging';
// DISABLED - Not in current priority list
// import { OldUnclearedCheckRule } from './rules/banking/old-uncleared-check';
import { UnreconciledTransactionAgingRule } from './rules/banking/unreconciled-transaction-aging';

// Workflow Rules
// DISABLED - Not in current priority list
// import { PaymentNotToUndepositedFundsRule } from './rules/workflow/payment-not-to-undeposited-funds';
// DISABLED - Not in current priority list
// import { DepositSumMismatchRule } from './rules/workflow/deposit-sum-mismatch';

// AR Rules
import { DuplicateInvoicesRule } from './rules/ar/duplicate-invoices';
// DISABLED - Not in current priority list
// import { InvoiceWithoutCustomerRule } from './rules/ar/invoice-without-customer';
import { NegativeARBalanceRule } from './rules/ar/negative-ar-balance';
import { UnappliedCreditMemosRule } from './rules/ar/unapplied-credit-memos';
import { PaymentWithoutInvoiceRule } from './rules/ar/payment-without-invoice';
import { DuplicatePaymentRule } from './rules/ar/duplicate-payment';
// DISABLED - Not in current priority list
// import { OverdueInvoiceRule } from './rules/ar/overdue-invoice';
// DISABLED - Not in current priority list
// import { InvoiceDateInFutureRule } from './rules/ar/invoice-date-in-future';
import { PaymentDateBeforeInvoiceRule } from './rules/ar/payment-date-before-invoice';
// DISABLED - Not in current priority list
// import { MultipleInvoicesSameAmountRule } from './rules/ar/multiple-invoices-same-amount';
// DISABLED - Not in current priority list
// import { InvoiceLineDirectToAccountRule } from './rules/ar/invoice-line-direct-to-account';
import { OverAppliedPaymentRule } from './rules/ar/over-applied-payment';
// DISABLED - Not in current priority list
// import { CustomerCreditNoInvoicesRule } from './rules/ar/customer-credit-no-invoices';

// AP Rules
import { BillPaymentWithoutBillRule } from './rules/ap/bill-payment-without-bill';
import { DuplicateVendorBillsRule } from './rules/ap/duplicate-vendor-bills';
import { NegativeApBalanceRule } from './rules/ap/negative-ap-balance';
import { VendorCreditsNotAppliedRule } from './rules/ap/vendor-credits-not-applied';
// DISABLED - Not in current priority list
// import { BillWithoutVendorRule } from './rules/ap/bill-without-vendor';
import { DuplicateBillPaymentsRule } from './rules/ap/duplicate-bill-payment';
// DISABLED - Not in current priority list
// import { BillDateInFutureRule } from './rules/ap/bill-date-in-future';
import { PaymentBeforeBillRule } from './rules/ap/payment-before-bill';
// DISABLED - Not in current priority list
// import { ExpenseInsteadOfBillPaymentRule } from './rules/ap/expense-instead-of-bill-payment';
// DISABLED - Not in current priority list
// import { MultipleBillsSameAmountRule } from './rules/ap/multiple-bills-same-amount';


export class RuleEngine {
    private realmId: RealmId;
    private connectionId: QbConnectionId;
    private repo: PrismaBrandedRepository;
    private logger: Logger;

    constructor(realmId: string, connectionId: string) {
        this.realmId = realmId as RealmId;
        this.connectionId = connectionId as QbConnectionId;
        this.repo = new PrismaBrandedRepository(prisma);
        this.logger = createLogger({ realmId, connectionId });

        // Register all rules
        this.registerRules();
    }

    private registerRules(): void {
        // Hygiene Rules
        ruleRegistry.register(new UnappliedPaymentsRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new DuplicateCustomersRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new DuplicateVendorsRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new UncategorizedTransactionsRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new TransactionWithoutMemoRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new SuspiciousRoundNumberTransactionRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new ExpenseWithoutVendorRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new LargeTransactionOutlierRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new HighJournalEntryUsageRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new InactiveCustomerBalanceRule());

        // Balance Rules
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new UnbalancedLedgerRule());
        ruleRegistry.register(new ArControlAccountMismatchRule());
        ruleRegistry.register(new ApControlAccountMismatchRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new JEWithoutNameRule());
        ruleRegistry.register(new DeletedAccountReferenceRule());
        ruleRegistry.register(new BrokenTransactionLinkRule());
        ruleRegistry.register(new OrphanedPaymentRule());
        ruleRegistry.register(new OrphanedBillPaymentRule());

        // Banking Rules
        ruleRegistry.register(new IncorrectDepositRecordingRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new UndepositedFundsGroupRule());
        ruleRegistry.register(new DuplicateDepositsRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new DepositWithoutCustomerRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new OrphanedDepositLineRule());
        ruleRegistry.register(new UndepositedFundsAgingRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new OldUnclearedCheckRule());
        ruleRegistry.register(new UnreconciledTransactionAgingRule());

        // Workflow Rules
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new PaymentNotToUndepositedFundsRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new DepositSumMismatchRule());

        // AR Rules
        ruleRegistry.register(new DuplicateInvoicesRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new InvoiceWithoutCustomerRule());
        ruleRegistry.register(new NegativeARBalanceRule());
        ruleRegistry.register(new UnappliedCreditMemosRule());
        ruleRegistry.register(new PaymentWithoutInvoiceRule());
        ruleRegistry.register(new DuplicatePaymentRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new OverdueInvoiceRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new InvoiceDateInFutureRule());
        ruleRegistry.register(new PaymentDateBeforeInvoiceRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new InvoiceLineDirectToAccountRule());
        ruleRegistry.register(new OverAppliedPaymentRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new CustomerCreditNoInvoicesRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new MultipleInvoicesSameAmountRule());

        // AP Rules
        ruleRegistry.register(new BillPaymentWithoutBillRule());
        ruleRegistry.register(new DuplicateVendorBillsRule());
        ruleRegistry.register(new NegativeApBalanceRule());
        ruleRegistry.register(new VendorCreditsNotAppliedRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new BillWithoutVendorRule());
        ruleRegistry.register(new DuplicateBillPaymentsRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new BillDateInFutureRule());
        ruleRegistry.register(new PaymentBeforeBillRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new ExpenseInsteadOfBillPaymentRule());
        // DISABLED - Not in current priority list
        // ruleRegistry.register(new MultipleBillsSameAmountRule());

        this.logger.info(`Registered ${ruleRegistry.getCount()} rules`);
    }


    async runAllRules(): Promise<{ issues: Issue[], checks: any[] }> {
        const allIssues: Issue[] = [];
        const allChecks: any[] = [];
        const rules = ruleRegistry.getAll();

        this.logger.info('Running all diagnostic rules', { ruleCount: rules.length });

        for (const rule of rules) {
            const startTime = Date.now();
            try {
                const context: RuleContext = {
                    realmId: this.realmId,
                    connectionId: this.connectionId,
                    repo: this.repo,
                    logger: this.logger.child({ ruleId: rule.id })
                };

                const result = await rule.execute(context);
                const durationMs = Date.now() - startTime;

                allIssues.push(...result.issues);
                allChecks.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    category: rule.category,
                    severity: rule.severity,
                    status: result.status,
                    message: result.message,
                    issueCount: result.issues.length,
                    durationMs
                });

                this.logger.debug(`Rule ${rule.id} completed`, {
                    status: result.status,
                    issueCount: result.issues.length,
                    durationMs
                });
            } catch (error) {
                const durationMs = Date.now() - startTime;
                this.logger.error(`Rule ${rule.id} failed`, error as Error);

                allChecks.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    category: rule.category,
                    status: 'FAILED',
                    message: (error as Error).message,
                    issueCount: 0,
                    durationMs
                });
            }
        }

        this.logger.info('All rules completed', {
            totalIssues: allIssues.length,
            totalChecks: allChecks.length
        });

        return { issues: allIssues, checks: allChecks };
    }

    async runRule(ruleId: string): Promise<RuleExecutionResult> {
        const rule = ruleRegistry.get(ruleId);

        if (!rule) {
            throw new Error(`Rule ${ruleId} not found`);
        }

        const context: RuleContext = {
            realmId: this.realmId,
            connectionId: this.connectionId,
            repo: this.repo,
            logger: this.logger.child({ ruleId })
        };

        return rule.execute(context);
    }

    async runRulesByCategory(category: string): Promise<{ issues: Issue[], checks: any[] }> {
        const rules = ruleRegistry.getByCategory(category);
        const allIssues: Issue[] = [];
        const allChecks: any[] = [];

        for (const rule of rules) {
            const startTime = Date.now();
            try {
                const result = await this.runRule(rule.id);
                const durationMs = Date.now() - startTime;

                allIssues.push(...result.issues);
                allChecks.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    category: rule.category,
                    severity: rule.severity,
                    status: result.status,
                    message: result.message,
                    issueCount: result.issues.length,
                    durationMs
                });
            } catch (error) {
                const durationMs = Date.now() - startTime;
                allChecks.push({
                    ruleId: rule.id,
                    ruleName: rule.name,
                    category: rule.category,
                    status: 'FAILED',
                    message: (error as Error).message,
                    issueCount: 0,
                    durationMs
                });
            }
        }

        return { issues: allIssues, checks: allChecks };
    }
}
