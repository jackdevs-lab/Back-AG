import { RuleEngine } from '../packages/rule-engine/src/engine';
import { prisma } from '@qb-health/financial-model';

async function testRules() {
    console.log('--- Testing New Banking Rules ---');
    
    // Find a connection to test with
    const connection = await prisma.qbConnection.findFirst({
        where: { isActive: true }
    });

    if (!connection) {
        console.error('No active QuickBooks connection found. Please connect a company first.');
        return;
    }

    console.log(`Using connection: ${connection.realmId} (${connection.companyName})`);

    const engine = new RuleEngine(connection.realmId, connection.id);
    const { checks } = await engine.runAllRules();

    console.log('\n--- Diagnostic Results ---');
    const bankingChecks = checks.filter(c => 
        ['duplicate-bank-transactions', 'missing-bank-transactions', 'incorrect-recon-balance', 
         'recon-modified', 'incorrect-deposit-recording', 'undeposited-funds-grouping', 
         'duplicate-deposits'].includes(c.ruleId)
    );

    bankingChecks.forEach(check => {
        const statusIcon = check.status === 'PASSED' ? '✅' : '❌';
        console.log(`${statusIcon} [${check.ruleId}] ${check.ruleName}: ${check.message}`);
    });
}

testRules()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
