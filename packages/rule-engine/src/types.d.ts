import { PrismaClient } from '@qb-health/financial-model';
import { Logger } from '@qb-health/utils';
export type Severity = 'CRITICAL' | 'WARNING' | 'INFO';
export interface RuleContext {
    realmId: string;
    prisma: PrismaClient;
    logger: Logger;
    connectionId: string;
}
export interface Issue {
    ruleId: string;
    ruleName: string;
    severity: Severity;
    message: string;
    entities: any[];
    metadata?: any;
}
export interface IRule {
    id: string;
    name: string;
    severity: Severity;
    description: string;
    category: 'HYGIENE' | 'BALANCE' | 'RECONCILIATION' | 'REPORTING';
    execute(context: RuleContext): Promise<Issue[]>;
}
