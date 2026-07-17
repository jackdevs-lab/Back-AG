// repair-data.ts
import { prisma } from './packages/financial-model/src/client.js';

async function repairDataPrimitives() {
    console.log('🔄 Repairing 7 affected payments in database...');

    const affectedIds = ['2722', '2733', '2732', '2728', '2727', '2725', '2723'];

    const updateResult = await prisma.transaction.updateMany({
        where: {
            type: 'Payment',
            qbId: { in: affectedIds }
        },
        data: {
            status: 'Open' // Unlocks them for the rule engine!
        }
    });

    console.log(`✅ Successfully repaired ${updateResult.count} payment statuses.`);
}

repairDataPrimitives()
    .catch(console.error)
    .finally(() => prisma.$disconnect());