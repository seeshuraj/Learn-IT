import crypto from "crypto";
import type { PoolClient } from "pg";
import { supabaseAdmin } from "./storage.js";

export function generateTempPassword(): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*";
  const upper   = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits  = "23456789";
  const special = "!@#$%^&*";
  const buf     = crypto.randomBytes(20);
  let pwd = "";
  pwd += upper[buf[0]   % upper.length];
  pwd += digits[buf[1]  % digits.length];
  pwd += special[buf[2] % special.length];
  for (let i = 3; i < 16; i++) pwd += charset[buf[i] % charset.length];
  const arr   = crypto.randomBytes(pwd.length);
  const chars = pwd.split("");
  for (let i = chars.length - 1; i > 0; i--) {
    const j = arr[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export async function createAuthUserAndIdentityMapRow(
  client: PoolClient,
  legacyUserId: number,
  email: string,
  role: string
): Promise<{ authUserId: string; tempPassword: string } | null> {
  const tempPassword = generateTempPassword();
  const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (authErr) {
    if (
      authErr.message.includes("already registered") ||
      authErr.message.includes("already been registered")
    ) {
      console.warn(`[Auth] user already exists for ${email} — skipping Auth creation`);
      return null;
    }
    console.error(`[Auth] createUser FAILED for ${email}:`, authErr.message);
    throw new Error(`Supabase Auth createUser failed: ${authErr.message}`);
  }
  const authUserId = authData.user.id;
  await client.query(
    `INSERT INTO user_identity_map (legacy_user_id, auth_user_id, role, force_password_change)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (legacy_user_id) DO UPDATE
       SET auth_user_id = EXCLUDED.auth_user_id,
           role = EXCLUDED.role,
           force_password_change = TRUE`,
    [legacyUserId, authUserId, role]
  );
  console.log(`[Auth] created Auth user ${authUserId} → legacy ${legacyUserId} (${email}) [force_password_change=true]`);
  return { authUserId, tempPassword };
}
