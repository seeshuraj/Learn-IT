# Database migrations

`supabase/migrations/` mirrors the migration history recorded in the live
project's `supabase_migrations.schema_migrations`, one file per applied
version. The files up to `20260515140132` were reproduced from that table and
checksum-verified against it. Seeded passwords and email addresses are
replaced with `<redacted>` / `<redacted-email>`: those seed migrations ran
once and must never be re-applied to a database holding real users.

## Rules

- Every schema change is a new timestamped file here. No dashboard edits.
- Apply with the Supabase CLI (`supabase db push`) or the Supabase MCP
  connector. The file's version must match what the remote records.
- Never edit an applied migration; add a new one.
- Policy or grant changes need an RLS/authorization test run before merge.
