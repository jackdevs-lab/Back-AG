import { RuleEngine } from '../packages/rule-engine/src/engine';
import { prisma } from '../packages/financial-model/src/client';
import * as fs from 'fs';

async function main() {
    const connection = await prisma.qbConnection.findFirst({
        where: { isActive: true }
    });

    if (!connection) {
        fs.writeFileSync('/tmp/analysis-results.json', JSON.stringify({ error: 'No active connections' }));
        return;
    }

    const engine = new RuleEngine(connection.realmId, connection.id);
    const results = await engine.runAllRules();

    fs.writeFileSync('/tmp/analysis-results.json', JSON.stringify(results, null, 2));
    console.log('Results written to /tmp/analysis-results.json');
}

main().catch(error => {
    fs.writeFileSync('/tmp/analysis-results.json', JSON.stringify({ error: error.message }));
}).finally(() => prisma.$disconnect());
