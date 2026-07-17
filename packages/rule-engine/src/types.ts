import { RealmId, QbConnectionId, RuleId, BrandedRepository } from '@qb-health/financial-model';
export { RuleId } from '@qb-health/financial-model';
import { Logger } from '@qb-health/utils';

export type HardenedPrisma = any;

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'WARNING' | 'INFO';

export interface RuleContext {
    realmId: RealmId;
    repo: BrandedRepository;
    logger: Logger;
    connectionId: QbConnectionId;
}

export interface Issue {
    ruleId: RuleId;
    ruleName: string;
    severity: Severity;
    message: string;
    entities: any[];
    fingerprint?: string;
    metadata?: any;
}

export interface RuleExecutionResult {
    issues: Issue[];
    status: 'PASSED' | 'FAILED' | 'WARNING' | 'ERROR';
    errorCode?: string;
    message?: string;
}

export interface IRule {
    id: RuleId;
    name: string;
    severity: Severity;
    description: string;
    category: 'HYGIENE' | 'BALANCE' | 'RECONCILIATION' | 'REPORTING' | 'BANK_ERRORS' | 'AR_ERRORS' | 'AP_ERRORS';
    execute(context: RuleContext): Promise<RuleExecutionResult>;
}
