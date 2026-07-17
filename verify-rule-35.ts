import 'dotenv/config';
import { PrismaClient } from './packages/financial-model/src';
import { BillPaymentWithoutBillRule } from './packages/rule-engine/src/rules/ap/bill-payment-without-bill';

async function verify() {
    const prisma = new PrismaClient();
    try {
        const connection = await (prisma as any).qbConnection.findFirst({
            where: { isActive: true },
            select: { id: true, realmId: true }
        });

        if (!connection) {
            console.error("No active qbConnection found in db.");
            return;
        }

        const dummyLogger = {
            info: (msg: string, meta?: any) => console.log("[INFO] " + msg, meta ? JSON.stringify(meta, null, 2) : ''),
            error: (msg: string, err?: any) => console.error("[ERROR] " + msg, err),
            warn: (msg: string, meta?: any) => console.warn("[WARN] " + msg, meta ? JSON.stringify(meta, null, 2) : ''),
            debug: (msg: string, meta?: any) => console.debug("[DEBUG] " + msg, meta ? JSON.stringify(meta, null, 2) : ''),
            child: () => dummyLogger
        } as any;

        console.log(`Starting Phase 5 verification for Rule 35 on Realm: ${connection.realmId}`);
        
        const rule = new BillPaymentWithoutBillRule();
        
        // Execute rule twice to test LRU rate limit cache logic (should increment safely)
        console.log("\n--- FIRST EXECUTION ---");
        let result = await rule.execute({
            realmId: connection.realmId,
            connectionId: connection.id,
            prisma: prisma as any,
            logger: dummyLogger
        });

        console.log("\n--- SECOND EXECUTION (Testing Caches) ---");
        result = await rule.execute({
            realmId: connection.realmId,
            connectionId: connection.id,
            prisma: prisma as any,
            logger: dummyLogger
        });

        console.log("\n--- RULE RESULT ---");
        console.log(`Status: ${result.status}`);
        
        if (result.issues.length > 0) {
            const ent = result.issues[0].entities[0];
            console.log(`\nSample Entity Metadata Output:`);
            console.log(`Currency Confidence: ${ent.currencyConfidence}`);
            console.log(`Vendor Confidence: ${ent.vendorConfidence}`);
            console.log(`Score Contribution:`, JSON.stringify(ent.auditMetadata.scoreContribution, null, 2));
            
            if (!ent.auditMetadata.scoreContribution) {
                console.error("FAILURE: scoreContribution metadata is missing.");
            } else {
                console.log("SUCCESS: scoreContribution metadata is present.");
            }
        } else {
            console.log("No issues found (expected on clean data).");
        }
        
        console.log("\n--- END VERIFICATION ---");

    } catch (error) {
        console.error("Verification failed:", error);
    } finally {
        await prisma.$disconnect();
    }
}

verify();
