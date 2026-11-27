import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  try {
    // Q1 - RuleFinding.findingData for DUPLICATE_VENDOR_BILLS
    console.log('\n=== Q1: RuleFinding findingData (DUPLICATE_VENDOR_BILLS) ===');
    const q1 = await prisma.$queryRawUnsafe(
      `SELECT "ruleId", "qbId", "findingData" FROM "RuleFinding" WHERE "ruleId" = 'DUPLICATE_VENDOR_BILLS' LIMIT 3`
    );
    console.log(JSON.stringify(q1, null, 2));

    // Q1b - all ruleIds in RuleFinding
    console.log('\n=== Q1b: All ruleIds in RuleFinding ===');
    const q1b = await prisma.$queryRawUnsafe(
      `SELECT "ruleId", COUNT(*) as cnt FROM "RuleFinding" GROUP BY "ruleId" ORDER BY cnt DESC`
    );
    console.log(JSON.stringify(q1b, null, 2));

    // Q2 - Transaction.rawData for entities in IssueEntity
    console.log('\n=== Q2: Transaction rawData sample ===');
    const q2 = await prisma.$queryRawUnsafe(
      `SELECT "qbId", "type", "amount"::text, "date", "rawData"
       FROM "Transaction"
       WHERE "qbId" IN (SELECT "entityId" FROM "IssueEntity" LIMIT 5)
       LIMIT 5`
    );
    console.log(JSON.stringify(q2, null, 2));

    // Q3a - Overall join match
    console.log('\n=== Q3a: IssueEntity -> Transaction join match (overall) ===');
    const q3a = await prisma.$queryRawUnsafe(
      `SELECT
         COUNT(*) FILTER (WHERE t."qbId" IS NOT NULL)::int AS matched,
         COUNT(*)::int AS total
       FROM "IssueEntity" ie
       LEFT JOIN "Transaction" t ON t."qbId" = ie."entityId"`
    );
    console.log(JSON.stringify(q3a, null, 2));

    // Q3b - By ruleId
    console.log('\n=== Q3b: IssueEntity -> Transaction join match (by rule) ===');
    const q3b = await prisma.$queryRawUnsafe(
      `SELECT i."ruleId",
              COUNT(*) FILTER (WHERE t."qbId" IS NOT NULL)::int AS matched,
              COUNT(*)::int AS total
       FROM "IssueEntity" ie
       JOIN "Issue" i ON i.id = ie."issueId"
       LEFT JOIN "Transaction" t ON t."qbId" = ie."entityId"
       GROUP BY i."ruleId"`
    );
    console.log(JSON.stringify(q3b, null, 2));

    // Q4 - Issue.deepLink and metadata for DUPLICATE_VENDOR_BILLS
    console.log('\n=== Q4: Issue deepLink + metadata ===');
    const q4 = await prisma.$queryRawUnsafe(
      `SELECT "ruleId", "deepLink", "metadata" FROM "Issue" WHERE "ruleId" = 'DUPLICATE_VENDOR_BILLS' LIMIT 3`
    );
    console.log(JSON.stringify(q4, null, 2));

    // Q4b - Sample deepLink across all rules
    console.log('\n=== Q4b: Issue deepLink sample across all rules ===');
    const q4b = await prisma.$queryRawUnsafe(
      `SELECT "ruleId", "deepLink", "metadata"
       FROM "Issue"
       WHERE "deepLink" IS NOT NULL
       LIMIT 5`
    );
    console.log(JSON.stringify(q4b, null, 2));

    // Q4c - metadata non-null sample
    console.log('\n=== Q4c: Issue metadata sample (non-null) ===');
    const q4c = await prisma.$queryRawUnsafe(
      `SELECT "ruleId", "deepLink", "metadata"
       FROM "Issue"
       WHERE "metadata" IS NOT NULL
       LIMIT 5`
    );
    console.log(JSON.stringify(q4c, null, 2));

    // Q5 - Which rules emit IssueEntity rows
    console.log('\n=== Q5: IssueEntity rows by rule ===');
    const q5 = await prisma.$queryRawUnsafe(
      `SELECT i."ruleId", COUNT(DISTINCT ie."entityId")::int AS entity_rows
       FROM "IssueEntity" ie
       JOIN "Issue" i ON i.id = ie."issueId"
       GROUP BY i."ruleId"
       ORDER BY entity_rows DESC`
    );
    console.log(JSON.stringify(q5, null, 2));

    // Q5b - Rules that have Issues but ZERO IssueEntity rows
    console.log('\n=== Q5b: Rules with Issues but zero IssueEntity rows ===');
    const q5b = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT i."ruleId"
       FROM "Issue" i
       WHERE NOT EXISTS (
         SELECT 1 FROM "IssueEntity" ie WHERE ie."issueId" = i.id
       )`
    );
    console.log(JSON.stringify(q5b, null, 2));

    // Q_BONUS: Sample rawData top-level keys from Transaction
    console.log('\n=== Q_BONUS: Top-level rawData keys from Transaction (by type) ===');
    const qBonus = await prisma.$queryRawUnsafe(
      `SELECT "type", jsonb_object_keys("rawData"::jsonb) AS key
       FROM "Transaction"
       LIMIT 200`
    );
    // Collect unique keys by type
    const keysByType = {};
    for (const row of qBonus) {
      if (!keysByType[row.type]) keysByType[row.type] = new Set();
      keysByType[row.type].add(row.key);
    }
    for (const [type, keys] of Object.entries(keysByType)) {
      keysByType[type] = [...keys];
    }
    console.log(JSON.stringify(keysByType, null, 2));

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
