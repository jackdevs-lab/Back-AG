import { Issue } from './types';
export declare class RuleEngine {
    private realmId;
    private connectionId;
    private logger;
    constructor(realmId: string, connectionId: string);
    private registerRules;
    runAllRules(): Promise<Issue[]>;
    runRule(ruleId: string): Promise<Issue[]>;
    runRulesByCategory(category: string): Promise<Issue[]>;
}
