#!/usr/bin/env npx tsx
/**
 * Generic SQL migration runner.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/run-migration.ts migrations/004_drop_cloudinary_url_columns.sql
 *
 * Or with a local .env file:
 *   npx tsx scripts/run-migration.ts migrations/004_drop_cloudinary_url_columns.sql
 *
 * The script reads the given .sql file, executes it against the database, and
 * exits 0 on success or 1 on error. It does not track applied migrations — it
 * is a simple one-shot runner for standalone SQL files.
 */

import pkg from "pg";
const { Pool } = pkg;
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.error("[run-migration] ERROR: DATABASE_URL must be set.");
  process.exit(1);
}

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error("[run-migration] Usage: npx tsx scripts/run-migration.ts <path/to/file.sql>");
  process.exit(1);
}

const absolutePath = path.resolve(sqlFile);
if (!fs.existsSync(absolutePath)) {
  console.error(`[run-migration] File not found: ${absolutePath}`);
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
});

async function main() {
  const sql = fs.readFileSync(absolutePath, "utf-8");
  console.log(`\n[run-migration] Running: ${sqlFile}`);
  console.log(`[run-migration] Connected to: ${DATABASE_URL.replace(/:([^:@]+)@/, ":***@")}\n`);

  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log(`[run-migration] ✓ ${path.basename(sqlFile)} applied successfully.\n`);
  } catch (e: any) {
    console.error(`[run-migration] ✗ Migration FAILED: ${e.message}`);
    client.release();
    await pool.end();
    process.exit(1);
  }

  client.release();
  await pool.end();
}

main().catch(e => {
  console.error("[run-migration] Fatal:", e.message);
  process.exit(1);
});
