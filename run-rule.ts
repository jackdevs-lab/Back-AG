import { PrismaClient } from './packages/financial-model/src';
import { ApControlAccountMismatchRule } from './packages/rule-engine/src/rules/balance/ap-control-account-mismatch';

async function run() {
    const prisma = new PrismaClient();
    try {
        const connection = await prisma.qbConnection.findFirst();
        if (!connection) {
            console.error("No qbConnection found in db.");
            return;
        }

        const dummyLogger = {
            info: (msg, meta) => console.log("[INFO] " + msg, JSON.stringify(meta, null, 2)),
            error: (msg, err) => console.error("[ERROR] " + msg, err),
            warn: (msg, meta) => console.warn("[WARN] " + msg, meta),
            debug: (msg, meta) => console.debug("[DEBUG] " + msg, meta),
            child: () => dummyLogger
        } as any;

        const rule = new ApControlAccountMismatchRule();
        const result = await rule.execute({
            realmId: connection.realmId,
            connectionId: connection.id,
            prisma,
            logger: dummyLogger
        });

        console.log("RULE RESULT:\n", JSON.stringify(result, null, 2));
    } finally {
        await prisma.$disconnect();
    }
}

run();
