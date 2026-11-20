// Removes everything the load test created: every row of each test college
// (slug starting "learnit-load-test-"), its users and their logins.
// Safe to run more than once; also cleans up after an interrupted run.
import { existsSync, readFileSync } from 'node:fs';
import { pool, admin, SLUG_PREFIX, EMAIL_DOMAIN } from './lib.mjs';

const db = pool();
const q = async (sql, params) => (await db.query(sql, params)).rows;

try {
  const colleges = await q(`SELECT id, slug FROM institutions WHERE slug LIKE $1`, [`${SLUG_PREFIX}%`]);
  const extraAuth = existsSync(`${process.env.OUT}/state.json`)
    ? JSON.parse(readFileSync(`${process.env.OUT}/state.json`, 'utf8')).authUserIds ?? [] : [];

  for (const c of colleges) {
    if (!c.slug.startsWith(SLUG_PREFIX)) continue; // belt and braces: never touch a real college
    const users = (await q(`SELECT user_id FROM institution_members WHERE institution_id = $1`, [c.id])).map(r => r.user_id);
    const authIds = (await q(`SELECT auth_user_id FROM user_identity_map WHERE legacy_user_id = ANY($1::int[]) AND auth_user_id IS NOT NULL`, [users]))
      .map(r => r.auth_user_id);

    // Every table with an institution_id: delete this college's rows, repeating
    // until foreign keys stop blocking (children go first naturally).
    const tables = (await q(`SELECT table_name FROM information_schema.columns
                             WHERE table_schema = 'public' AND column_name = 'institution_id' AND table_name <> 'institutions'
                               AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')`))
      .map(r => r.table_name);
    let pending = [...tables];
    for (let pass = 0; pass < 12 && pending.length; pass++) {
      const left = [];
      for (const t of pending) {
        try { await db.query(`DELETE FROM public."${t}" WHERE institution_id = $1`, [c.id]); }
        catch { left.push(t); }
      }
      pending = left;
    }
    if (pending.length) throw new Error(`Could not clear: ${pending.join(', ')}`);

    // Rows keyed by user only.
    for (const sql of [
      `DELETE FROM user_identity_map WHERE legacy_user_id = ANY($1::int[])`,
      `DELETE FROM password_reset_tokens WHERE user_id = ANY($1::int[])`,
      `DELETE FROM users WHERE id = ANY($1::int[]) AND email LIKE '%@${EMAIL_DOMAIN}'`,
    ]) await db.query(sql, [users]).catch(() => undefined);
    await q(`DELETE FROM institutions WHERE id = $1 AND slug LIKE $2`, [c.id, `${SLUG_PREFIX}%`]);

    const sb = admin();
    for (const id of new Set([...authIds, ...extraAuth])) await sb.auth.admin.deleteUser(id).catch(() => undefined);
    console.log(`Removed test college ${c.slug}: ${users.length} users, ${new Set([...authIds, ...extraAuth]).size} logins.`);
  }
  // Any login left from a run that failed before its rows were mapped.
  const sb = admin();
  for (let page = 1; page < 50; page++) {
    const { data } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    const stray = (data?.users ?? []).filter(u => u.email?.endsWith(`@${EMAIL_DOMAIN}`));
    for (const u of stray) await sb.auth.admin.deleteUser(u.id).catch(() => undefined);
    if (!data?.users?.length || data.users.length < 1000) break;
  }
  const [left] = await q(`SELECT count(*)::int n FROM users WHERE email LIKE '%@${EMAIL_DOMAIN}'`);
  console.log(left.n === 0 ? 'Teardown complete: no test data left.' : `Teardown: ${left.n} test users still present.`);
} catch (e) {
  console.error('Teardown failed:', e.message, '— run teardown again; it is safe to repeat.');
  process.exitCode = 1;
} finally {
  await db.end();
}
