import 'dotenv/config';
import { prisma } from '../packages/financial-model/src/client';

async function main() {
    try {
        const args = process.argv.slice(2);
        const targetRealmId = args[0] || process.env.TEST_REALM_ID;

        if (targetRealmId) {
            console.log(`Setting subscription status to ACTIVE for realmId: "${targetRealmId}"...`);
            const connection = await prisma.qbConnection.findUnique({
                where: { realmId: targetRealmId }
            });

            if (!connection) {
                console.error(`Error: No QuickBooks connection found for realmId: "${targetRealmId}"`);
                await listConnections();
                return;
            }

            const updated = await prisma.qbConnection.update({
                where: { realmId: targetRealmId },
                data: {
                    subscriptionStatus: 'ACTIVE',
                    paystackCustCode: connection.paystackCustCode || 'MOCK_CUSTOMER',
                    paystackPlanCode: connection.paystackPlanCode || 'MOCK_PLAN'
                }
            });

            console.log(`\nSUCCESS: Subscription status updated successfully!`);
            console.log(`Company: "${updated.companyName || 'Unknown'}" | realmId: "${updated.realmId}" | New Status: ${updated.subscriptionStatus}`);
        } else {
            console.log('No specific realm ID provided. Subscribing ALL connections in the database...');
            const connections = await prisma.qbConnection.findMany();

            if (connections.length === 0) {
                console.log('\nNo connections found in the database. Please connect a company first.');
                return;
            }

            for (const conn of connections) {
                const updated = await prisma.qbConnection.update({
                    where: { id: conn.id },
                    data: {
                        subscriptionStatus: 'ACTIVE',
                        paystackCustCode: conn.paystackCustCode || 'MOCK_CUSTOMER',
                        paystackPlanCode: conn.paystackPlanCode || 'MOCK_PLAN'
                    }
                });
                console.log(`- Company: "${updated.companyName || 'Unknown'}" | realmId: "${updated.realmId}" | New Status: ${updated.subscriptionStatus}`);
            }

            console.log(`\nSUCCESS: All ${connections.length} connections have been successfully subscribed (ACTIVE)!`);
        }
    } catch (error) {
        console.error('An error occurred executing the script:', error);
    } finally {
        await prisma.$disconnect();
    }
}

async function listConnections() {
    const connections = await prisma.qbConnection.findMany({
        select: { realmId: true, companyName: true, subscriptionStatus: true }
    });
    if (connections.length > 0) {
        console.log('\nAvailable connections in database:');
        connections.forEach(conn => {
            console.log(`- Company: "${conn.companyName || 'Unknown'}" | realmId: "${conn.realmId}" | Current Status: ${conn.subscriptionStatus}`);
        });
    } else {
        console.log('\nNo connections found in the database.');
    }
}

main();
