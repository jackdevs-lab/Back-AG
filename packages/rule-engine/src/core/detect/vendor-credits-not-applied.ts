// core/detect/vendor-credits-not-applied.ts
import { Prisma } from '@qb-health/financial-model';

export function isCreditUnapplied(
    balance: Prisma.Decimal,
    threshold: Prisma.Decimal
): boolean {
    return balance.abs().gte(threshold.abs());
}
