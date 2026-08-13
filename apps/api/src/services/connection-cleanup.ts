import { prisma } from '@qb-health/financial-model';
import { logger } from '@qb-health/utils';

export async function deleteConnectionData(connectionId: string): Promise<boolean> {
    const connection = await prisma.qbConnection.findUnique({
        where: { id: connectionId },
        select: {
            id: true,
            realmId: true,
        },
    });

    if (!connection) {
        return false;
    }

    const tables = [
        prisma.ruleFinding,
        prisma.account,
        prisma.transaction,
        prisma.customer,
        prisma.vendor,
        prisma.bankTransaction,
        prisma.reconciliation,
        prisma.ruleConfig,
    ];

    await prisma.$transaction([
        ...tables.map((table) =>
            (table as any).deleteMany({
                where: { realmId: connection.realmId },
            })
        ),
        prisma.qbConnection.delete({
            where: { id: connection.id },
        }),
    ]);

    return true;
}