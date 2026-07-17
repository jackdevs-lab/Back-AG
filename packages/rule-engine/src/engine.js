"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RuleEngine = void 0;
// packages/rule-engine/src/engine.ts
const financial_model_1 = require("@qb-health/financial-model");
const utils_1 = require("@qb-health/utils");
const registry_1 = require("./registry");
// Import all rules
const unapplied_payments_1 = require("./rules/hygiene/unapplied-payments");
const duplicate_customers_1 = require("./rules/hygiene/duplicate-customers");
const uncategorized_transactions_1 = require("./rules/hygiene/uncategorized-transactions");
const unbalanced_ledger_1 = require("./rules/balance/unbalanced-ledger");
class RuleEngine {
    realmId;
    connectionId;
    logger;
    constructor(realmId, connectionId) {
        this.realmId = realmId;
        this.connectionId = connectionId;
        this.logger = (0, utils_1.createLogger)({ realmId, connectionId });
        // Register all rules
        this.registerRules();
    }
    registerRules() {
        registry_1.ruleRegistry.register(new unapplied_payments_1.UnappliedPaymentsRule());
        registry_1.ruleRegistry.register(new duplicate_customers_1.DuplicateCustomersRule());
        registry_1.ruleRegistry.register(new uncategorized_transactions_1.UncategorizedTransactionsRule());
        registry_1.ruleRegistry.register(new unbalanced_ledger_1.UnbalancedLedgerRule());
        this.logger.info(`Registered ${registry_1.ruleRegistry.getCount()} rules`);
    }
    async runAllRules() {
        const allIssues = [];
        const rules = registry_1.ruleRegistry.getAll();
        this.logger.info('Running all diagnostic rules', { ruleCount: rules.length });
        for (const rule of rules) {
            try {
                const context = {
                    realmId: this.realmId,
                    connectionId: this.connectionId,
                    prisma: financial_model_1.prisma,
                    logger: this.logger.child({ ruleId: rule.id })
                };
                const issues = await rule.execute(context);
                allIssues.push(...issues);
                this.logger.debug(`Rule ${rule.id} completed`, { issueCount: issues.length });
            }
            catch (error) {
                this.logger.error(`Rule ${rule.id} failed`, error);
                // Continue with other rules even if one fails
            }
        }
        this.logger.info('All rules completed', { totalIssues: allIssues.length });
        return allIssues;
    }
    async runRule(ruleId) {
        const rule = registry_1.ruleRegistry.get(ruleId);
        if (!rule) {
            throw new Error(`Rule ${ruleId} not found`);
        }
        const context = {
            realmId: this.realmId,
            connectionId: this.connectionId,
            prisma: financial_model_1.prisma,
            logger: this.logger.child({ ruleId })
        };
        return rule.execute(context);
    }
    async runRulesByCategory(category) {
        const rules = registry_1.ruleRegistry.getByCategory(category);
        const allIssues = [];
        for (const rule of rules) {
            const issues = await this.runRule(rule.id);
            allIssues.push(...issues);
        }
        return allIssues;
    }
}
exports.RuleEngine = RuleEngine;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiZW5naW5lLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHFDQUFxQztBQUNyQyxnRUFBb0Q7QUFDcEQsNENBQXdEO0FBQ3hELHlDQUEwQztBQUcxQyxtQkFBbUI7QUFDbkIsMkVBQTJFO0FBQzNFLDZFQUE2RTtBQUM3RSwyRkFBMkY7QUFDM0YseUVBQXlFO0FBRXpFLE1BQWEsVUFBVTtJQUNYLE9BQU8sQ0FBUztJQUNoQixZQUFZLENBQVM7SUFDckIsTUFBTSxDQUFTO0lBRXZCLFlBQVksT0FBZSxFQUFFLFlBQW9CO1FBQzdDLElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO1FBQ3ZCLElBQUksQ0FBQyxZQUFZLEdBQUcsWUFBWSxDQUFDO1FBQ2pDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxvQkFBWSxFQUFDLEVBQUUsT0FBTyxFQUFFLFlBQVksRUFBRSxDQUFDLENBQUM7UUFFdEQscUJBQXFCO1FBQ3JCLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztJQUN6QixDQUFDO0lBRU8sYUFBYTtRQUNqQix1QkFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLDBDQUFxQixFQUFFLENBQUMsQ0FBQztRQUNuRCx1QkFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLDRDQUFzQixFQUFFLENBQUMsQ0FBQztRQUNwRCx1QkFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLDBEQUE2QixFQUFFLENBQUMsQ0FBQztRQUMzRCx1QkFBWSxDQUFDLFFBQVEsQ0FBQyxJQUFJLHdDQUFvQixFQUFFLENBQUMsQ0FBQztRQUVsRCxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxjQUFjLHVCQUFZLENBQUMsUUFBUSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQ3BFLENBQUM7SUFFRCxLQUFLLENBQUMsV0FBVztRQUNiLE1BQU0sU0FBUyxHQUFZLEVBQUUsQ0FBQztRQUM5QixNQUFNLEtBQUssR0FBRyx1QkFBWSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBRXBDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLDhCQUE4QixFQUFFLEVBQUUsU0FBUyxFQUFFLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBRTlFLEtBQUssTUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLENBQUM7WUFDdkIsSUFBSSxDQUFDO2dCQUNELE1BQU0sT0FBTyxHQUFnQjtvQkFDekIsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO29CQUNyQixZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVk7b0JBQy9CLE1BQU0sRUFBTix3QkFBTTtvQkFDTixNQUFNLEVBQUUsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxDQUFDO2lCQUNqRCxDQUFDO2dCQUVGLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztnQkFDM0MsU0FBUyxDQUFDLElBQUksQ0FBQyxHQUFHLE1BQU0sQ0FBQyxDQUFDO2dCQUUxQixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRLElBQUksQ0FBQyxFQUFFLFlBQVksRUFBRSxFQUFFLFVBQVUsRUFBRSxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztZQUNsRixDQUFDO1lBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztnQkFDYixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxRQUFRLElBQUksQ0FBQyxFQUFFLFNBQVMsRUFBRSxLQUFjLENBQUMsQ0FBQztnQkFDNUQsOENBQThDO1lBQ2xELENBQUM7UUFDTCxDQUFDO1FBRUQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMscUJBQXFCLEVBQUUsRUFBRSxXQUFXLEVBQUUsU0FBUyxDQUFDLE1BQU0sRUFBRSxDQUFDLENBQUM7UUFDM0UsT0FBTyxTQUFTLENBQUM7SUFDckIsQ0FBQztJQUVELEtBQUssQ0FBQyxPQUFPLENBQUMsTUFBYztRQUN4QixNQUFNLElBQUksR0FBRyx1QkFBWSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUV0QyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDUixNQUFNLElBQUksS0FBSyxDQUFDLFFBQVEsTUFBTSxZQUFZLENBQUMsQ0FBQztRQUNoRCxDQUFDO1FBRUQsTUFBTSxPQUFPLEdBQWdCO1lBQ3pCLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTztZQUNyQixZQUFZLEVBQUUsSUFBSSxDQUFDLFlBQVk7WUFDL0IsTUFBTSxFQUFOLHdCQUFNO1lBQ04sTUFBTSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEVBQUUsTUFBTSxFQUFFLENBQUM7U0FDeEMsQ0FBQztRQUVGLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUNqQyxDQUFDO0lBRUQsS0FBSyxDQUFDLGtCQUFrQixDQUFDLFFBQWdCO1FBQ3JDLE1BQU0sS0FBSyxHQUFHLHVCQUFZLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBQ25ELE1BQU0sU0FBUyxHQUFZLEVBQUUsQ0FBQztRQUU5QixLQUFLLE1BQU0sSUFBSSxJQUFJLEtBQUssRUFBRSxDQUFDO1lBQ3ZCLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDM0MsU0FBUyxDQUFDLElBQUksQ0FBQyxHQUFHLE1BQU0sQ0FBQyxDQUFDO1FBQzlCLENBQUM7UUFFRCxPQUFPLFNBQVMsQ0FBQztJQUNyQixDQUFDO0NBQ0o7QUFoRkQsZ0NBZ0ZDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gcGFja2FnZXMvcnVsZS1lbmdpbmUvc3JjL2VuZ2luZS50c1xyXG5pbXBvcnQgeyBwcmlzbWEgfSBmcm9tICdAcWItaGVhbHRoL2ZpbmFuY2lhbC1tb2RlbCc7XHJcbmltcG9ydCB7IGNyZWF0ZUxvZ2dlciwgTG9nZ2VyIH0gZnJvbSAnQHFiLWhlYWx0aC91dGlscyc7XHJcbmltcG9ydCB7IHJ1bGVSZWdpc3RyeSB9IGZyb20gJy4vcmVnaXN0cnknO1xyXG5pbXBvcnQgeyBJUnVsZSwgUnVsZUNvbnRleHQsIElzc3VlIH0gZnJvbSAnLi90eXBlcyc7XHJcblxyXG4vLyBJbXBvcnQgYWxsIHJ1bGVzXHJcbmltcG9ydCB7IFVuYXBwbGllZFBheW1lbnRzUnVsZSB9IGZyb20gJy4vcnVsZXMvaHlnaWVuZS91bmFwcGxpZWQtcGF5bWVudHMnO1xyXG5pbXBvcnQgeyBEdXBsaWNhdGVDdXN0b21lcnNSdWxlIH0gZnJvbSAnLi9ydWxlcy9oeWdpZW5lL2R1cGxpY2F0ZS1jdXN0b21lcnMnO1xyXG5pbXBvcnQgeyBVbmNhdGVnb3JpemVkVHJhbnNhY3Rpb25zUnVsZSB9IGZyb20gJy4vcnVsZXMvaHlnaWVuZS91bmNhdGVnb3JpemVkLXRyYW5zYWN0aW9ucyc7XHJcbmltcG9ydCB7IFVuYmFsYW5jZWRMZWRnZXJSdWxlIH0gZnJvbSAnLi9ydWxlcy9iYWxhbmNlL3VuYmFsYW5jZWQtbGVkZ2VyJztcclxuXHJcbmV4cG9ydCBjbGFzcyBSdWxlRW5naW5lIHtcclxuICAgIHByaXZhdGUgcmVhbG1JZDogc3RyaW5nO1xyXG4gICAgcHJpdmF0ZSBjb25uZWN0aW9uSWQ6IHN0cmluZztcclxuICAgIHByaXZhdGUgbG9nZ2VyOiBMb2dnZXI7XHJcblxyXG4gICAgY29uc3RydWN0b3IocmVhbG1JZDogc3RyaW5nLCBjb25uZWN0aW9uSWQ6IHN0cmluZykge1xyXG4gICAgICAgIHRoaXMucmVhbG1JZCA9IHJlYWxtSWQ7XHJcbiAgICAgICAgdGhpcy5jb25uZWN0aW9uSWQgPSBjb25uZWN0aW9uSWQ7XHJcbiAgICAgICAgdGhpcy5sb2dnZXIgPSBjcmVhdGVMb2dnZXIoeyByZWFsbUlkLCBjb25uZWN0aW9uSWQgfSk7XHJcblxyXG4gICAgICAgIC8vIFJlZ2lzdGVyIGFsbCBydWxlc1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJSdWxlcygpO1xyXG4gICAgfVxyXG5cclxuICAgIHByaXZhdGUgcmVnaXN0ZXJSdWxlcygpOiB2b2lkIHtcclxuICAgICAgICBydWxlUmVnaXN0cnkucmVnaXN0ZXIobmV3IFVuYXBwbGllZFBheW1lbnRzUnVsZSgpKTtcclxuICAgICAgICBydWxlUmVnaXN0cnkucmVnaXN0ZXIobmV3IER1cGxpY2F0ZUN1c3RvbWVyc1J1bGUoKSk7XHJcbiAgICAgICAgcnVsZVJlZ2lzdHJ5LnJlZ2lzdGVyKG5ldyBVbmNhdGVnb3JpemVkVHJhbnNhY3Rpb25zUnVsZSgpKTtcclxuICAgICAgICBydWxlUmVnaXN0cnkucmVnaXN0ZXIobmV3IFVuYmFsYW5jZWRMZWRnZXJSdWxlKCkpO1xyXG5cclxuICAgICAgICB0aGlzLmxvZ2dlci5pbmZvKGBSZWdpc3RlcmVkICR7cnVsZVJlZ2lzdHJ5LmdldENvdW50KCl9IHJ1bGVzYCk7XHJcbiAgICB9XHJcblxyXG4gICAgYXN5bmMgcnVuQWxsUnVsZXMoKTogUHJvbWlzZTxJc3N1ZVtdPiB7XHJcbiAgICAgICAgY29uc3QgYWxsSXNzdWVzOiBJc3N1ZVtdID0gW107XHJcbiAgICAgICAgY29uc3QgcnVsZXMgPSBydWxlUmVnaXN0cnkuZ2V0QWxsKCk7XHJcblxyXG4gICAgICAgIHRoaXMubG9nZ2VyLmluZm8oJ1J1bm5pbmcgYWxsIGRpYWdub3N0aWMgcnVsZXMnLCB7IHJ1bGVDb3VudDogcnVsZXMubGVuZ3RoIH0pO1xyXG5cclxuICAgICAgICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcclxuICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGNvbnRleHQ6IFJ1bGVDb250ZXh0ID0ge1xyXG4gICAgICAgICAgICAgICAgICAgIHJlYWxtSWQ6IHRoaXMucmVhbG1JZCxcclxuICAgICAgICAgICAgICAgICAgICBjb25uZWN0aW9uSWQ6IHRoaXMuY29ubmVjdGlvbklkLFxyXG4gICAgICAgICAgICAgICAgICAgIHByaXNtYSxcclxuICAgICAgICAgICAgICAgICAgICBsb2dnZXI6IHRoaXMubG9nZ2VyLmNoaWxkKHsgcnVsZUlkOiBydWxlLmlkIH0pXHJcbiAgICAgICAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgICAgICAgIGNvbnN0IGlzc3VlcyA9IGF3YWl0IHJ1bGUuZXhlY3V0ZShjb250ZXh0KTtcclxuICAgICAgICAgICAgICAgIGFsbElzc3Vlcy5wdXNoKC4uLmlzc3Vlcyk7XHJcblxyXG4gICAgICAgICAgICAgICAgdGhpcy5sb2dnZXIuZGVidWcoYFJ1bGUgJHtydWxlLmlkfSBjb21wbGV0ZWRgLCB7IGlzc3VlQ291bnQ6IGlzc3Vlcy5sZW5ndGggfSk7XHJcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihgUnVsZSAke3J1bGUuaWR9IGZhaWxlZGAsIGVycm9yIGFzIEVycm9yKTtcclxuICAgICAgICAgICAgICAgIC8vIENvbnRpbnVlIHdpdGggb3RoZXIgcnVsZXMgZXZlbiBpZiBvbmUgZmFpbHNcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhpcy5sb2dnZXIuaW5mbygnQWxsIHJ1bGVzIGNvbXBsZXRlZCcsIHsgdG90YWxJc3N1ZXM6IGFsbElzc3Vlcy5sZW5ndGggfSk7XHJcbiAgICAgICAgcmV0dXJuIGFsbElzc3VlcztcclxuICAgIH1cclxuXHJcbiAgICBhc3luYyBydW5SdWxlKHJ1bGVJZDogc3RyaW5nKTogUHJvbWlzZTxJc3N1ZVtdPiB7XHJcbiAgICAgICAgY29uc3QgcnVsZSA9IHJ1bGVSZWdpc3RyeS5nZXQocnVsZUlkKTtcclxuXHJcbiAgICAgICAgaWYgKCFydWxlKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgUnVsZSAke3J1bGVJZH0gbm90IGZvdW5kYCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBjb250ZXh0OiBSdWxlQ29udGV4dCA9IHtcclxuICAgICAgICAgICAgcmVhbG1JZDogdGhpcy5yZWFsbUlkLFxyXG4gICAgICAgICAgICBjb25uZWN0aW9uSWQ6IHRoaXMuY29ubmVjdGlvbklkLFxyXG4gICAgICAgICAgICBwcmlzbWEsXHJcbiAgICAgICAgICAgIGxvZ2dlcjogdGhpcy5sb2dnZXIuY2hpbGQoeyBydWxlSWQgfSlcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICByZXR1cm4gcnVsZS5leGVjdXRlKGNvbnRleHQpO1xyXG4gICAgfVxyXG5cclxuICAgIGFzeW5jIHJ1blJ1bGVzQnlDYXRlZ29yeShjYXRlZ29yeTogc3RyaW5nKTogUHJvbWlzZTxJc3N1ZVtdPiB7XHJcbiAgICAgICAgY29uc3QgcnVsZXMgPSBydWxlUmVnaXN0cnkuZ2V0QnlDYXRlZ29yeShjYXRlZ29yeSk7XHJcbiAgICAgICAgY29uc3QgYWxsSXNzdWVzOiBJc3N1ZVtdID0gW107XHJcblxyXG4gICAgICAgIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xyXG4gICAgICAgICAgICBjb25zdCBpc3N1ZXMgPSBhd2FpdCB0aGlzLnJ1blJ1bGUocnVsZS5pZCk7XHJcbiAgICAgICAgICAgIGFsbElzc3Vlcy5wdXNoKC4uLmlzc3Vlcyk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gYWxsSXNzdWVzO1xyXG4gICAgfVxyXG59Il19