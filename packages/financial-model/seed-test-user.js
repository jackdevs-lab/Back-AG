// seed-test-user.js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function seed() {
    try {
        const hashedPassword = await bcrypt.hash('password123', 10);

        // 1. Ensure tenant exists
        const tenant = await prisma.tenant.upsert({
            where: { id: 'test-tenant-id' },
            update: { name: 'Test Company', email: 'contact@testcompany.com' },
            create: {
                id: 'test-tenant-id',
                name: 'Test Company',
                email: 'contact@testcompany.com',
            },
        });

        // 2. Create / update User with correct compound key
        const user = await prisma.user.upsert({
            where: {
                tenantId_email: {
                    tenantId: tenant.id,
                    email: 'test@example.com',
                }
            },
            update: {
                password: hashedPassword,
                role: 'USER',
            },
            create: {
                email: 'test@example.com',
                password: hashedPassword,
                tenantId: tenant.id,
                role: 'USER',
            },
        });

        console.log('✅ SUCCESS!');
        console.log('Tenant ID :', tenant.id);
        console.log('User Email:', user.email);
        console.log('Password  : password123 (hashed correctly)');
        console.log('User ID   :', user.id);

    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await prisma.$disconnect();
    }
}

seed();