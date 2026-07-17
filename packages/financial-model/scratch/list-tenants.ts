import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from root
dotenv.config({ path: path.join(__dirname, '../../../.env') });

const prisma = new PrismaClient();

async function main() {
    const tenants = await prisma.tenant.findMany({
        take: 10
    });
    console.log('Current Tenants:', JSON.stringify(tenants, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
