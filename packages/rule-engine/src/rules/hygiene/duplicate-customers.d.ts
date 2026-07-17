import { IRule, RuleContext, Issue , RuleId } from '../../types';
export declare class DuplicateCustomersRule implements IRule {
    id: string;
    name: string;
    severity: "WARNING";
    description: string;
    category: "HYGIENE";
    execute(ctx: RuleContext): Promise<Issue[]>;
}

