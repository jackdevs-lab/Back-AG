import { prisma } from '../packages/financial-model/src/client';
import bcrypt from 'bcryptjs';

async function main() {
    const email = 'test@example.com';
    const password = 'password123';

    const user = await prisma.user.findFirst({
        where: { email: email.toLowerCase().trim() }
    });

    if (!user) {
        console.log(`User ${email} not found in database.`);
        return;
    }

    console.log(`User found: ${user.email}`);
    const isValid = await bcrypt.compare(password, user.password);
    console.log(`Is password '${password}' valid? ${isValid}`);
    
    // Also check for common variations
    const is123Valid = await bcrypt.compare('123', user.password);
    console.log(`Is password '123' valid? ${is123Valid}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
