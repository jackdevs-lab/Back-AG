// scan-primitives.ts
import { prisma } from './packages/financial-model/src/client.js';

async function runAuditDiagnostics() {
    console.log('🚀 Initializing Data Primitive Integrity Scan...');

    // 1. Scan for Payments mapped as 'Completed' that still hold an Unapplied Amount
    const mismappedPayments = await prisma.transaction.findMany({
        where: {
            type: 'Payment',
            status: 'Completed'
        },
        select: { qbId: true, rawData: true }
    });

    let paymentAnomalyCount = 0;
    for (const tx of mismappedPayments) {
        const raw = tx.rawData as any;
        const unapplied = Number(raw?.UnappliedAmt ?? 0);
        if (unapplied > 0) {
            paymentAnomalyCount++;
            console.log(`⚠️  [Mismapped Payment] QBO ID: ${tx.qbId} is marked 'Completed' in DB but has $${unapplied} unapplied.`);
        }
    }

    // 2. Scan for overlapping active issues inflating your metrics
    const duplicates = await prisma.$queryRaw`
        SELECT "qbId", COUNT(*) as occurrence_count
        FROM "RuleFinding"
        GROUP BY "qbId"
        HAVING COUNT(*) > 1
    `;

    console.log('\n📊 Diagnostic Summary:');
    console.log(`- Stale/Mismapped Payments found: ${paymentAnomalyCount}`);
    console.log(`- Cross-rule duplicate transaction records: ${(duplicates as any[]).length}`);

    if (paymentAnomalyCount > 0 || (duplicates as any[]).length > 0) {
        console.log('\n❌ System check failed: Fix the ingestion status mapping and deduplicate your dashboard queries.');
    } else {
        console.log('\n✅ Data primitives match application expectations.');
    }
}

runAuditDiagnostics()
    .catch(console.error)
    .finally(() => prisma.$disconnect());