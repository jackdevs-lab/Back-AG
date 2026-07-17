import { IRule } from './types';
import { logger } from '@qb-health/utils';

export class RuleRegistry {
    private rules: Map<string, IRule> = new Map();

    register(rule: IRule): void {
        if (this.rules.has(rule.id)) {
            logger.warn(`Rule ${rule.id} already registered, overwriting`);
        }
        this.rules.set(rule.id, rule);
        logger.info(`Rule registered: ${rule.id} - ${rule.name}`);
    }

    get(ruleId: string): IRule | undefined {
        return this.rules.get(ruleId);
    }

    getAll(): IRule[] {
        return Array.from(this.rules.values());
    }

    getByCategory(category: string): IRule[] {
        return this.getAll().filter(rule => rule.category === category);
    }

    getCount(): number {
        return this.rules.size;
    }
}

export const ruleRegistry = new RuleRegistry();
