// Scheduled (EventBridge) daily backup of the whole Supabase Postgres
// database into S3 — plain-JS row dump (no pg_dump/psql binaries needed,
// which aren't available in the Lambda runtime without a custom layer).
// This function only ever WRITES new backups; restoring is a separate,
// deliberately manual/local script (infra/restore-backup.js) — a restore
// overwrites live data, so it must never run unattended.
import { Client } from 'pg';
import { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import zlib from 'node:zlib';

const s3 = new S3Client({});
const BUCKET = process.env.BACKUP_BUCKET;
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 30);

async function dumpAllTables(client) {
  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
     order by table_name`,
  );

  const dump = {};
  const counts = {};
  for (const { table_name: tableName } of tables) {
    const { rows } = await client.query(`select * from "${tableName}"`);
    dump[tableName] = rows;
    counts[tableName] = rows.length;
  }
  return { dump, counts };
}

async function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'backups/' }));
  const stale = (list.Contents ?? []).filter((obj) => obj.LastModified.getTime() < cutoff);
  await Promise.all(stale.map((obj) => s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: obj.Key }))));
  return stale.length;
}

export const handler = async () => {
  // The direct db.<ref>.supabase.co host is IPv6-only, and Lambda's default
  // (non-VPC) networking is IPv4-only — connect through Supabase's Supavisor
  // pooler instead, which resolves to real IPv4 addresses. Transaction-mode
  // port (6543) suits Lambda's one-connection-per-invocation pattern; the
  // pooler needs the project ref appended to the username.
  const client = new Client({
    host: process.env.SUPABASE_POOLER_HOST,
    port: 6543,
    user: `postgres.${process.env.SUPABASE_PROJECT_REF}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  let result;
  try {
    result = await dumpAllTables(client);
  } finally {
    await client.end();
  }

  const timestamp = new Date().toISOString();
  const payload = JSON.stringify({ timestamp, tables: result.dump });
  const gzipped = zlib.gzipSync(payload);

  const key = `backups/${timestamp.replace(/:/g, '-')}/data.json.gz`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: gzipped, ContentType: 'application/gzip' }));

  const manifestKey = `backups/${timestamp.replace(/:/g, '-')}/manifest.json`;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: manifestKey,
    Body: JSON.stringify({ timestamp, rowCounts: result.counts, dataKey: key }, null, 2),
    ContentType: 'application/json',
  }));

  const pruned = await pruneOldBackups();

  return { ok: true, timestamp, tables: Object.keys(result.counts).length, rowCounts: result.counts, prunedOldBackups: pruned };
};
