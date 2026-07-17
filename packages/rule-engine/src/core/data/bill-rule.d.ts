import { Prisma } from '@qb-health/financial-model';
import { RawTransaction, FetchTransactionsParams } from './types';
/**
 * Fetches Bills from the database with standard AP filters.
 * Implements cursor-based pagination for memory safety.
 */
export declare function fetchBills(prisma: any, params: FetchTransactionsParams): Promise<RawTransaction[]>;
/**
 * Grouped candidate search for duplicate detection.
 * Uses Prisma's groupBy to identify potential duplicates before full record load.
 */
export declare function fetchDuplicateBillCandidates(prisma: any, params: {
    realmId: string;
    lookbackDate: Date;
}): Promise<any[]>;
