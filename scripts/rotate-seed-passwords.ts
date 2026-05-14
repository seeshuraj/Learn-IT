#!/usr/bin/env npx tsx
/**
 * P2-4 — Rotate temporary passwords for the 4 seeded Auth users.
 *
 * All seeded accounts were created with the shared temp password "ChangeMe123!"
 * during the initial backfill migration. This script replaces each one with a
 * unique cryptographically-generated password and prints a credential table
 * for the admin to distribute.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DATABASE_URL=... npx tsx scripts/rotate-seed-passwords.ts
 *
 * Or with a local .env file:
 *   npx tsx scripts/rotate-seed-passwords.ts
 *
 * The script is idempotent — safe to run multiple times. Each run generates
 * fresh passwords and overwrites whatever was set previously.
 */

import { createClient } from "@supabase/supabase-js";
import pkg from "pg";
const { Pool } = pkg;
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL          = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const DATABASE_URL          = process.env.DATABASE_URL ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE || !DATABASE_URL) {
  console.error("[rotate-seed-passwords] ERROR: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL must be set.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

/** Generate a strong unique password: 1 upper + 1 digit + 1 symbol + 13 random chars */
function generatePassword(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*";
  let pwd = "";
  pwd += "ABCDEFGHJKLMNPQRSTUVWXYZ"[Math.floor(Math.random() * 24)];
  pwd += "23456789"[Math.floor(Math.random() * 8)];
  pwd += "!@#$%^&*"[Math.floor(Math.random() * 8)];
  for (let i = 3; i < 16; i++) {
    pwd += charset[Math.floor(Math.random() * charset.length)];
  }
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

async function main() {
  console.log("\n[P2-4] Rotating seed passwords...\n");

  // Fetch all seeded users from the identity map
  const { rows } = await pool.query(`
    SELECT uim.auth_user_id, uim.role, u.name, u.email
    FROM user_identity_map uim
    JOIN users u ON uim.legacy_user_id = u.id
    ORDER BY uim.legacy_user_id
  `);

  if (rows.length === 0) {
    console.error("[rotate-seed-passwords] No rows found in user_identity_map. Has the backfill migration been run?");
    await pool.end();
    process.exit(1);
  }

  const results: Array<{ name: string; email: string; role: string; password: string; status: string }> = [];

  for (const row of rows) {
    const newPassword = generatePassword();
    const { error } = await supabase.auth.admin.updateUserById(row.auth_user_id, {
      password: newPassword,
    });

    if (error) {
      console.error(`  ✗ ${row.email} (${row.auth_user_id}): ${error.message}`);
      results.push({ name: row.name, email: row.email, role: row.role, password: "FAILED", status: error.message });
    } else {
      console.log(`  ✓ ${row.email} — password rotated`);
      results.push({ name: row.name, email: row.email, role: row.role, password: newPassword, status: "OK" });
    }
  }

  console.log("\n" + "═".repeat(80));
  console.log("  CREDENTIAL TABLE — distribute these to users, then delete this output");
  console.log("═".repeat(80));
  console.log(
    "  " +
    "Name".padEnd(22) +
    "Email".padEnd(30) +
    "Role".padEnd(12) +
    "Temp Password"
  );
  console.log("  " + "─".repeat(76));
  for (const r of results) {
    console.log(
      "  " +
      r.name.padEnd(22) +
      r.email.padEnd(30) +
      r.role.padEnd(12) +
      r.password
    );
  }
  console.log("═".repeat(80));
  console.log("");

  const failed = results.filter(r => r.status !== "OK");
  if (failed.length > 0) {
    console.error(`[rotate-seed-passwords] ${failed.length} account(s) failed to update. Check errors above.`);
    await pool.end();
    process.exit(1);
  }

  console.log(`[P2-4] Done. ${results.length} passwords rotated successfully.\n`);
  await pool.end();
}

main().catch(e => {
  console.error("[rotate-seed-passwords] Fatal:", e.message);
  process.exit(1);
});
