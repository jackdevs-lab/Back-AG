import 'dotenv/config';
import { PrismaClient } from './packages/financial-model/src';

async function main() {
    const prisma = new PrismaClient();
    
    try {
        const realmId = process.env.TEST_REALM_ID;
        const args = process.argv.slice(2);
        const command = args[0]?.toLowerCase(); // "subscribe", "unsubscribe", "toggle", or undefined (defaults to toggle)

        if (!realmId) {
            console.error("Error: TEST_REALM_ID is not defined in your .env file.");
            console.log("\nPlease add it to your .env file, for example:");
            console.log('TEST_REALM_ID="1234567890"');
            
            // List existing connections to help the user find their realmId
            const connections = await prisma.qbConnection.findMany({
                select: { realmId: true, companyName: true, subscriptionStatus: true }
            });
            
            if (connections.length > 0) {
                console.log("\nHere are the existing QuickBooks connections in your database:");
                connections.forEach(conn => {
                    console.log(`- Company: ${conn.companyName || 'Unknown'} | realmId: "${conn.realmId}" | Current Status: ${conn.subscriptionStatus}`);
                });
            } else {
                console.log("\nNo QuickBooks connections found in the database. Please connect a company first.");
            }
            return;
        }

        // Find connection by realmId
        const connection = await prisma.qbConnection.findUnique({
            where: { realmId }
        });

        if (!connection) {
            console.error(`Error: No QuickBooks connection found for realmId: "${realmId}"`);
            
            // List existing connections for help
            const connections = await prisma.qbConnection.findMany({
                select: { realmId: true, companyName: true, subscriptionStatus: true }
            });
            if (connections.length > 0) {
                console.log("\nAvailable connections in database:");
                connections.forEach(conn => {
                    console.log(`- Company: ${conn.companyName || 'Unknown'} | realmId: "${conn.realmId}" | Current Status: ${conn.subscriptionStatus}`);
                });
            }
            return;
        }

        let targetStatus: 'ACTIVE' | 'INACTIVE';

        if (command === 'subscribe' || command === 'active') {
            targetStatus = 'ACTIVE';
        } else if (command === 'unsubscribe' || command === 'inactive') {
            targetStatus = 'INACTIVE';
        } else {
            // Toggle
            targetStatus = connection.subscriptionStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
        }

        console.log(`Current subscription status for "${connection.companyName}" (${realmId}): ${connection.subscriptionStatus}`);
        console.log(`Updating status to: ${targetStatus}...`);

        const updated = await prisma.qbConnection.update({
            where: { realmId },
            data: { subscriptionStatus: targetStatus }
        });

        console.log(`\nSUCCESS: Subscription status updated successfully!`);
        console.log(`New Status: ${updated.subscriptionStatus}`);
    } catch (err) {
        console.error("An error occurred executing the script:", err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
