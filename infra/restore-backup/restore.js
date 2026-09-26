// Deliberately manual, deliberately not automated — restoring overwrites
// whatever is currently in the database, so this always requires explicit
// confirmation and is meant to be run by a person, never on a schedule.
//
// Usage:
//   node restore.js <path-to-data.json.gz> --yes
//
// Get a backup file first:
//   aws s3 cp s3://<bucket>/backups/<timestamp>/data.json.gz ./data.json.gz
//
// Required env vars: SUPABASE_POOLER_HOST, SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD
// (the direct db.<ref>.supabase.co host is IPv6-only; the pooler resolves to
// real IPv4 addresses, which is what actually matters here — plain IPv6
// connectivity from your own machine works too, but the pooler is one
// connection method that's guaranteed to work everywhere, including Lambda.)

import fs from 'node:fs';
import zlib from 'node:zlib';
import { Client } from 'pg';

// Parent tables before the tables that reference them — TRUNCATE below
// truncates everything in one statement (which Postgres allows regardless
// of FK direction), but INSERT order still has to respect foreign keys.
const TABLE_ORDER = [
  'conversations', 'messages', 'facts', 'routing_logs',
  'skills', 'agent_config', 'push_subscriptions', 'tool_config',
  'artifacts', 'connectors', 'app_settings', 'usage_log', 'scheduled_tasks',
];

async function main() {
  const [, , filePath, confirmFlag] = process.argv;
  if (!filePath) {
    console.error('Usage: node restore.js <path-to-data.json.gz> --yes');
    process.exit(1);
  }
  if (confirmFlag !== '--yes') {
    console.error('This OVERWRITES the live database. Re-run with --yes once you\'re sure:');
    console.error(`  node restore.js ${filePath} --yes`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath);
  const json = filePath.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const { timestamp, tables } = JSON.parse(json);

  console.log(`Backup timestamp: ${timestamp}`);
  for (const [table, rows] of Object.entries(tables)) console.log(`  ${table}: ${rows.length} rows`);

  const client = new Client({
    host: process.env.SUPABASE_POOLER_HOST,
    port: 6543,
    user: `postgres.${process.env.SUPABASE_PROJECT_REF}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query('BEGIN');

    const tableNames = Object.keys(tables);
    await client.query(`TRUNCATE ${tableNames.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

    const orderedNames = [...TABLE_ORDER.filter((t) => tableNames.includes(t)), ...tableNames.filter((t) => !TABLE_ORDER.includes(t))];

    for (const table of orderedNames) {
      const rows = tables[table];
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const colList = columns.map((c) => `"${c}"`).join(', ');

      for (const row of rows) {
        const values = columns.map((c) => row[c]);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(`insert into "${table}" (${colList}) values (${placeholders})`, values);
      }
      console.log(`Restored ${rows.length} rows into ${table}`);
    }

    await client.query('COMMIT');
    console.log('Restore complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Restore failed, rolled back:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
