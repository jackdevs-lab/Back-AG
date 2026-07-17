import { prisma } from '@qb-health/financial-model';



async function main() {
  const realmId = process.argv[2];

  if (!realmId) {
    console.error('Usage: npx tsx authorize_realm.ts <realmId>');
    process.exit(1);
  }

  try {
    const connection = await prisma.qbConnection.findUnique({
      where: { realmId },
    });

    if (!connection) {
      console.error(`Error: No QuickBooks connection found for realmId: ${realmId}`);
      process.exit(1);
    }

    const updated = await prisma.qbConnection.update({
      where: { realmId },
      data: {
        subscriptionStatus: 'ACTIVE',
        // Optional: you might want to set fake paystack codes if the app expects them
        paystackCustCode: 'MANUAL_OVERRIDE',
        paystackPlanCode: 'MANUAL_PLAN'
      },
    });

    console.log(`Success: Realm ID ${realmId} (${updated.companyName}) is now authorized as ACTIVE.`);
    console.table({
      realmId: updated.realmId,
      companyName: updated.companyName,
      subscriptionStatus: updated.subscriptionStatus,
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    console.error('Error updating connection:', error);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
