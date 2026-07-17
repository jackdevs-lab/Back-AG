//(production ready)
import { z } from 'zod';

import { IRule, RuleContext, RuleExecutionResult, RuleId } from '../../types';
import { PipelineRunner } from '../../core/pipeline-runner';

import { transactionGenerator, normalizeTransactionBatch, fetchAccounts } from '../../core/shared/data-primitives';
import {
    EnrichedFinding,
    JournalEntryRawSchema,
    BillRawSchema,
    DepositRawSchema,
    PurchaseRawSchema
} from '../../core/shared/base-schemas';

import { generateFingerprint } from '../../core/shared/utils';
import { formatReport } from '../../core/report/deleted-account-reference';

function extractAccountRefs(txn: any): { accountId: string; detailType: string }[] {
    const refs: { accountId: string; detailType: string }[] = [];
    const lines = txn.rawData?.Line || txn.qboData?.Line || [];

    for (const line of lines) {
        if (line.JournalEntryLineDetail?.AccountRef?.value) {
            refs.push({ accountId: line.JournalEntryLineDetail.AccountRef.value, detailType: 'JournalEntryLineDetail' });
        }
        if (line.DepositLineDetail?.AccountRef?.value) {
            refs.push({ accountId: line.DepositLineDetail.AccountRef.value, detailType: 'DepositLineDetail' });
        }
        if (line.AccountBasedExpenseLineDetail?.AccountRef?.value) {
            refs.push({ accountId: line.AccountBasedExpenseLineDetail.AccountRef.value, detailType: 'AccountBasedExpenseLineDetail' });
        }
    }
    return refs;
}

interface DataPayload {
    batch: any[];
    validIds: Set<string>;
}

interface NormalizedPayload {
    transactions: any[];
    unscannable: any[];
    validIds: Set<string>;
}

interface DetectionPayload {
    findings: any[];
}

export class DeletedAccountReferenceRule implements IRule {
    id: RuleId = 'DELETED_ACCOUNT_REFERENCE' as unknown as RuleId;
    name = 'Transaction with Deleted Account Reference';
    severity = 'CRITICAL' as const;
    description = 'Detects transactions that reference an account ID which no longer exists in the Chart of Accounts.';
    category = 'BALANCE' as const;
    version = '3.0.0';

    public async execute(ctx: RuleContext): Promise<RuleExecutionResult> {
        return new PipelineRunner<
            DataPayload[],
            NormalizedPayload,
            DetectionPayload,
            EnrichedFinding
        >(ctx, this.id, this.name, this.version)
            .withData(async (repo, realmId) => {
                const validAccounts = await fetchAccounts(repo, { realmId, active: true });
                const validIds = new Set(validAccounts.map((a: any) => a.qbId));

                const generator = transactionGenerator(repo, {
                    realmId,
                    type: ['JournalEntry', 'Bill', 'Invoice', 'Payment', 'Deposit', 'Purchase', 'VendorCredit']
                });

                async function* buildStream() {
                    for await (const batch of generator) {
                        yield [{ batch, validIds }];
                    }
                }

                return buildStream();
            })
            .withNormalization((dataArr: DataPayload[]) => {
                const data = dataArr[0];
                const MixedTxnSchema = z.union([
                    JournalEntryRawSchema,
                    BillRawSchema,
                    DepositRawSchema,
                    PurchaseRawSchema,
                    z.any()
                ]);

                const { normalized, unscannable } = normalizeTransactionBatch(data.batch, MixedTxnSchema);
                return { transactions: normalized, unscannable, validIds: data.validIds };
            })
            .withDetection((norm: NormalizedPayload) => {
                const findings: any[] = [];
                const validIds = norm.validIds;

                for (const txn of norm.transactions) {
                    const refs = extractAccountRefs(txn);
                    for (const ref of refs) {
                        if (ref.accountId && !validIds.has(ref.accountId)) {
                            findings.push({
                                txn,
                                accountId: ref.accountId,
                                detailType: ref.detailType
                            });
                        }
                    }
                }
                return { findings };
            })
            .withEnrichment((det: DetectionPayload, ctx: RuleContext): EnrichedFinding[] => {
                return det.findings.map((f: any): EnrichedFinding => {
                    return {
                        id: f.txn.qbId,
                        label: `${f.txn.type || 'Transaction'} ${f.txn.qbId} - References deleted account \`${f.accountId}\``,
                        date: new Date(f.txn.date),
                        amount: f.txn.amount,
                        currency: f.txn.rawData?.CurrencyRef?.value || 'USD',
                        metadata: {
                            accountId: f.accountId,
                            detailType: f.detailType,
                            impactScore: 80,
                            fingerprint: generateFingerprint([f.txn.qbId, f.accountId]),
                        }
                    };
                });
            })
            .withReporting((reportData: any, ctx: RuleContext, unscannable: any[]) => {
                return formatReport(ctx.realmId, reportData, unscannable);
            })
            .execute();
    }
}
