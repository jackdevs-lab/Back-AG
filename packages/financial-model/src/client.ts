import { PrismaClient } from '@prisma/client';
import { logger } from '@qb-health/utils';

declare global {
    var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma || new PrismaClient({
    log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'info' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
    ],
    errorFormat: 'pretty'
});

// @ts-ignore
// @ts-ignore
prisma.$on('error', (e: any) => {
    const err = e instanceof Error
        ? e
        : Object.assign(new Error(String(e?.message ?? e)), {
            code: e?.code,
            name: e?.name,
        });
    logger.error('Prisma Error:', err, {
        code: e?.code,
        name: e?.name,
    });
});

// @ts-ignore
prisma.$on('warn', (e: any) => {
    logger.warn('Prisma Warning:', e.message || e);
});

if (process.env.NODE_ENV !== 'production') {
    global.prisma = prisma;
}

export default prisma;