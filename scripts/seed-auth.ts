import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash('password123', 10);
  
  const tenant = await prisma.tenant.upsert({
    where: { id: 'test-tenant-id' },
    update: {},
    create: {
      id: 'test-tenant-id',
      name: 'Test Company',
      email: 'contact@testcompany.com',
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'test@example.com' },
    update: {
      password: password,
    },
    create: {
      email: 'test@example.com',
      password: password,
      tenantId: tenant.id,
    },
  });

  console.log('Seed completed:');
  console.log('Tenant:', tenant.id);
  console.log('User:', user.email);
  console.log('Password: password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
