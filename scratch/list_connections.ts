import { prisma } from '@qb-health/financial-model';



async function main() {
  const connections = await prisma.qbConnection.findMany({
    select: {
      realmId: true,
      companyName: true,
      subscriptionStatus: true,
      updatedAt: true,
    },
    orderBy: {
      updatedAt: 'desc',
    },
  });

  console.log('Current QuickBooks Connections:');
  console.table(connections);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
