
const { Client } = require('pg');
require('dotenv').config();

async function check() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  try {
    const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'DiagnosticCheck' AND column_name = 'severity'");
    console.log('Severity column found:', res.rows.length > 0);
  } finally {
    await client.end();
  }
}

check().catch(console.error);
