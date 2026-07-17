import '@qb-health/financial-model';
import { Prisma } from '@qb-health/financial-model';

/**
 * Global Prisma Client Augmentation
 * 
 * Provides native type information for models and fields managed in the 
 * financial-model package. Using explicit module anchoring to ensure 
 * correct interface merging across the monorepo workspace.
 */
declare module '@qb-health/financial-model' {
  interface PrismaClient {
    ruleFinding: {
      findMany(args: any): Promise<any[]>;
      createMany(args: { data: any[], skipDuplicates?: boolean }): Promise<{ count: number }>;
    };
  }

  interface QbConnection {
    timezone: string;
  }
}
