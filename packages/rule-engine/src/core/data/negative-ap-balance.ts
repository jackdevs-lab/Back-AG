import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@qb-health/financial-model';
import { fetchRuleConfig } from '../shared/data-primitives';

export { fetchRuleConfig };

export interface NegativeBalanceRecord {
    vendorId: string;
    vendorName: string;
    balance: number;
}

export interface FetchNegativeBalancesParams {
    realmId: string;
    lookbackDate?: Date;
    threshold?: number;
    limit?: number;
}

/**
 * Generator for negative AP balances.
 */
export async function* getNegativeBalancesGenerator(
    prisma: PrismaClient,
    params: FetchNegativeBalancesParams
) {
    const threshold = params.threshold ?? 0;
    const sanitizedNegativeThreshold = -Math.abs(threshold);
    const lookbackDate = params.lookbackDate ?? new Date(0);

    const results = await prisma.$queryRaw<NegativeBalanceRecord[]>`
        SELECT 
            t."vendorId",
            COALESCE(v.name, 'Unknown Vendor') as "vendorName",
            SUM(CASE 
                WHEN t.type = 'Bill' THEN CAST(t.amount AS NUMERIC) 
                ELSE -CAST(t.amount AS NUMERIC) 
            END) AS balance
        FROM "Transaction" t
        INNER JOIN "Vendor" v 
            ON t."vendorId" = v."qbId" 
            AND t."realmId" = v."realmId"
        WHERE t."realmId" = ${params.realmId}
        AND t."vendorId" IS NOT NULL
        AND t.type IN ('Bill', 'BillPayment')
        AND t.status NOT IN ('Voided', 'Deleted')
        AND v.active = true
        AND t.date >= ${lookbackDate}
        GROUP BY t."vendorId", v.name
        HAVING SUM(CASE 
            WHEN t.type = 'Bill' THEN CAST(t.amount AS NUMERIC) 
            ELSE -CAST(t.amount AS NUMERIC) 
        END) < ${sanitizedNegativeThreshold}
        LIMIT ${params.limit ?? 5000}
    `;

    yield results;
}
