# Database migrations

`supabase/migrations/` mirrors the migration history recorded in the live
project's `supabase_migrations.schema_migrations`, one file per applied
version. The files up to `20260515140132` were reproduced from that table and
checksum-verified against it. Seeded passwords and email addresses are
replaced with `<redacted>` / `<redacted-email>`: those seed migrations ran
once and must never be re-applied to a database holding real users.

## Rules

- Every schema change is a new timestamped file here. No dashboard edits.
- Apply with the Supabase MCP connector (see below: `supabase db push` is not
  safe against production yet). The file's version must match what the remote records.
- Never edit an applied migration; add a new one.
- Policy or grant changes need an RLS/authorization test run before merge.

## Production project and recorded history

Production is the **LearnIT (Mumbai)** project (`idytyybyyqutkgwrqjzl`,
ap-south-1). It was created on 2026-11-07 by restoring the schema, so its
`schema_migrations` table only records the migrations applied since then, and
their versions differ from the file names here (they were stamped when each was
applied through the connector, e.g. `perf_fk_indexes_and_rls_initplan` is
`20261109070331` remotely and `20261108120000` here). The schema itself matches
the files: verified on 2026-11-19 by comparing every RLS policy and helper.

Consequences until the history is repaired:

- Do not run `supabase db push` against production: the CLI would treat the
  older files as unapplied and re-run them. Apply new migrations with the
  Supabase MCP connector (`apply_migration`) or the SQL editor, then rename the
  new file here to the version production recorded (`list_migrations`).
- `20261119120000_rls_tenant_isolation_and_lockdown.sql` was run from the
  SQL Editor on 2026-11-19 (the connector's confirmation kept timing out), so
  production's `schema_migrations` has no row for it even though it is applied.
  Verified afterwards: 31 `tenant_isolation` policies, no `anon`/`authenticated`
  table privileges, helpers `SECURITY DEFINER`. Include it when repairing.
- To repair, mark each file as applied with
  `supabase migration repair --status applied <file-version>` and revert the
  remote-only versions with `--status reverted <remote-version>`, then check
  `supabase migration list` shows the two sides aligned.

## Security model

The browser uses Supabase only for Auth. All data goes through the API, which
connects as the table owner. `anon` and `authenticated` therefore hold no
privileges on `public` tables or sequences, and default privileges are revoked
so new tables don't regain them. RLS stays enabled as a second layer: every
policy-bearing table has a restrictive `tenant_isolation` policy, and the
policy helpers are `SECURITY DEFINER` so policies can't recurse.
`e2e/tenancy.mjs` checks all of this in CI with two seeded colleges.
