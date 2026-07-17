import { IRule } from './types';
export declare class RuleRegistry {
    private rules;
    register(rule: IRule): void;
    get(ruleId: string): IRule | undefined;
    getAll(): IRule[];
    getByCategory(category: string): IRule[];
    getCount(): number;
}
export declare const ruleRegistry: RuleRegistry;
