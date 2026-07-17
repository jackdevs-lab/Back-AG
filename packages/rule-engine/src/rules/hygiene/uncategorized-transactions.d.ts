import { IRule, RuleContext, Issue , RuleId } from '../../types';
export declare class UncategorizedTransactionsRule implements IRule {
    id: string;
    name: string;
    severity: "CRITICAL";
    description: string;
    category: "HYGIENE";
    execute(ctx: RuleContext): Promise<Issue[]>;
}

