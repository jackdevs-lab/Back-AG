import { IRule, RuleContext, Issue , RuleId } from '../../types';
export declare class UnbalancedLedgerRule implements IRule {
    id: string;
    name: string;
    severity: "CRITICAL";
    description: string;
    category: "BALANCE";
    execute(ctx: RuleContext): Promise<Issue[]>;
}

