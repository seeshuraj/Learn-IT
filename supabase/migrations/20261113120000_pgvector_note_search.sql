-- Note search moves into Postgres (pgvector).
--
-- Before: every tutor question loaded all of a module's chunk vectors (JSON
-- text, ~25 KB each) into Node and ranked them there. Memory and transfer grew
-- with module size × concurrent questions.
-- After: vectors are stored as halfvec (2 bytes per dimension, ~4 KB for 2048
-- dims) and Postgres returns only the top-K chunks.
--
-- Retrieval is always filtered to one module (and to the notes a student may
-- see), so it is an exact search over that module's chunks: it uses the
-- existing notes(module_id) and note_chunks(note_id) indexes and its cost grows
-- with the module, not with the whole database. No ANN index is added: an
-- HNSW index ranks globally and then filters, which loses recall for
-- per-module queries, and halfvec without fixed dimensions keeps embedding
-- model changes (different vector sizes) a config change.
--
-- Rollout: the trigger keeps the old JSON column and the new vector column in
-- step, so the previous backend version keeps working until the new one is
-- deployed. A later migration drops note_chunks.embedding and the trigger.

create extension if not exists vector with schema extensions;

alter table public.note_chunks add column if not exists embedding_vec extensions.halfvec;

comment on column public.note_chunks.embedding_vec is
  'Chunk embedding (halfvec). Compare only rows with the same embedding_model.';

update public.note_chunks
set embedding_vec = embedding::extensions.halfvec
where embedding is not null and embedding_vec is null;

create or replace function public.note_chunks_sync_embedding_vec()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.embedding is not null
     and (tg_op = 'INSERT' or new.embedding is distinct from old.embedding) then
    new.embedding_vec := new.embedding::extensions.halfvec;
  end if;
  return new;
end;
$$;

revoke all on function public.note_chunks_sync_embedding_vec() from public, anon, authenticated;

drop trigger if exists note_chunks_sync_embedding_vec on public.note_chunks;
create trigger note_chunks_sync_embedding_vec
  before insert or update of embedding on public.note_chunks
  for each row execute function public.note_chunks_sync_embedding_vec();
