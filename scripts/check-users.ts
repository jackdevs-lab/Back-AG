import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

async function check() {
  const users = await prisma.user.findMany({
    select: { email: true, id: true, tenantId: true }
  });
  console.log('Database Users:', users);
}

check()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
