"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UncategorizedTransactionsRule = void 0;
class UncategorizedTransactionsRule {
    id = 'UNCATEGORIZED_TRANSACTION';
    name = 'Uncategorized Transactions';
    severity = 'CRITICAL';
    description = 'Detects transactions without proper account categorization';
    category = 'HYGIENE';
    async execute(ctx) {
        const transactions = await ctx.prisma.transaction.findMany({
            where: {
                realmId: ctx.realmId,
                categoryId: null
            },
            take: 100 // Limit for performance
        });
        if (transactions.length === 0) {
            return [];
        }
        return [{
                ruleId: this.id,
                ruleName: this.name,
                severity: this.severity,
                message: `Found ${transactions.length} uncategorized transaction(s)`,
                entities: transactions.map(t => ({
                    id: t.qbId,
                    type: t.type,
                    amount: t.amount,
                    date: t.date
                }))
            }];
    }
}
exports.UncategorizedTransactionsRule = UncategorizedTransactionsRule;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidW5jYXRlZ29yaXplZC10cmFuc2FjdGlvbnMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ1bmNhdGVnb3JpemVkLXRyYW5zYWN0aW9ucy50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFHQSxNQUFhLDZCQUE2QjtJQUN0QyxFQUFFLEdBQUcsMkJBQTJCLENBQUM7SUFDakMsSUFBSSxHQUFHLDRCQUE0QixDQUFDO0lBQ3BDLFFBQVEsR0FBRyxVQUFtQixDQUFDO0lBQy9CLFdBQVcsR0FBRyw0REFBNEQsQ0FBQztJQUMzRSxRQUFRLEdBQUcsU0FBa0IsQ0FBQztJQUU5QixLQUFLLENBQUMsT0FBTyxDQUFDLEdBQWdCO1FBQzFCLE1BQU0sWUFBWSxHQUFHLE1BQU0sR0FBRyxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDO1lBQ3ZELEtBQUssRUFBRTtnQkFDSCxPQUFPLEVBQUUsR0FBRyxDQUFDLE9BQU87Z0JBQ3BCLFVBQVUsRUFBRSxJQUFJO2FBQ25CO1lBQ0QsSUFBSSxFQUFFLEdBQUcsQ0FBQyx3QkFBd0I7U0FDckMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxZQUFZLENBQUMsTUFBTSxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzVCLE9BQU8sRUFBRSxDQUFDO1FBQ2QsQ0FBQztRQUVELE9BQU8sQ0FBQztnQkFDSixNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUU7Z0JBQ2YsUUFBUSxFQUFFLElBQUksQ0FBQyxJQUFJO2dCQUNuQixRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVE7Z0JBQ3ZCLE9BQU8sRUFBRSxTQUFTLFlBQVksQ0FBQyxNQUFNLCtCQUErQjtnQkFDcEUsUUFBUSxFQUFFLFlBQVksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDO29CQUM3QixFQUFFLEVBQUUsQ0FBQyxDQUFDLElBQUk7b0JBQ1YsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJO29CQUNaLE1BQU0sRUFBRSxDQUFDLENBQUMsTUFBTTtvQkFDaEIsSUFBSSxFQUFFLENBQUMsQ0FBQyxJQUFJO2lCQUNmLENBQUMsQ0FBQzthQUNOLENBQUMsQ0FBQztJQUNQLENBQUM7Q0FDSjtBQWpDRCxzRUFpQ0MiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBwYWNrYWdlcy9ydWxlLWVuZ2luZS9zcmMvcnVsZXMvaHlnaWVuZS91bmNhdGVnb3JpemVkLXRyYW5zYWN0aW9ucy50c1xyXG5pbXBvcnQgeyBJUnVsZSwgUnVsZUNvbnRleHQsIElzc3VlIH0gZnJvbSAnLi4vLi4vdHlwZXMnO1xyXG5cclxuZXhwb3J0IGNsYXNzIFVuY2F0ZWdvcml6ZWRUcmFuc2FjdGlvbnNSdWxlIGltcGxlbWVudHMgSVJ1bGUge1xyXG4gICAgaWQgPSAnVU5DQVRFR09SSVpFRF9UUkFOU0FDVElPTic7XHJcbiAgICBuYW1lID0gJ1VuY2F0ZWdvcml6ZWQgVHJhbnNhY3Rpb25zJztcclxuICAgIHNldmVyaXR5ID0gJ0NSSVRJQ0FMJyBhcyBjb25zdDtcclxuICAgIGRlc2NyaXB0aW9uID0gJ0RldGVjdHMgdHJhbnNhY3Rpb25zIHdpdGhvdXQgcHJvcGVyIGFjY291bnQgY2F0ZWdvcml6YXRpb24nO1xyXG4gICAgY2F0ZWdvcnkgPSAnSFlHSUVORScgYXMgY29uc3Q7XHJcblxyXG4gICAgYXN5bmMgZXhlY3V0ZShjdHg6IFJ1bGVDb250ZXh0KTogUHJvbWlzZTxJc3N1ZVtdPiB7XHJcbiAgICAgICAgY29uc3QgdHJhbnNhY3Rpb25zID0gYXdhaXQgY3R4LnByaXNtYS50cmFuc2FjdGlvbi5maW5kTWFueSh7XHJcbiAgICAgICAgICAgIHdoZXJlOiB7XHJcbiAgICAgICAgICAgICAgICByZWFsbUlkOiBjdHgucmVhbG1JZCxcclxuICAgICAgICAgICAgICAgIGNhdGVnb3J5SWQ6IG51bGxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgdGFrZTogMTAwIC8vIExpbWl0IGZvciBwZXJmb3JtYW5jZVxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBpZiAodHJhbnNhY3Rpb25zLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgICByZXR1cm4gW107XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4gW3tcclxuICAgICAgICAgICAgcnVsZUlkOiB0aGlzLmlkLFxyXG4gICAgICAgICAgICBydWxlTmFtZTogdGhpcy5uYW1lLFxyXG4gICAgICAgICAgICBzZXZlcml0eTogdGhpcy5zZXZlcml0eSxcclxuICAgICAgICAgICAgbWVzc2FnZTogYEZvdW5kICR7dHJhbnNhY3Rpb25zLmxlbmd0aH0gdW5jYXRlZ29yaXplZCB0cmFuc2FjdGlvbihzKWAsXHJcbiAgICAgICAgICAgIGVudGl0aWVzOiB0cmFuc2FjdGlvbnMubWFwKHQgPT4gKHtcclxuICAgICAgICAgICAgICAgIGlkOiB0LnFiSWQsXHJcbiAgICAgICAgICAgICAgICB0eXBlOiB0LnR5cGUsXHJcbiAgICAgICAgICAgICAgICBhbW91bnQ6IHQuYW1vdW50LFxyXG4gICAgICAgICAgICAgICAgZGF0ZTogdC5kYXRlXHJcbiAgICAgICAgICAgIH0pKVxyXG4gICAgICAgIH1dO1xyXG4gICAgfVxyXG59Il19