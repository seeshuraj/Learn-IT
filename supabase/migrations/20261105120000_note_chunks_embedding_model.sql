-- Record which embedding model produced each note_chunks vector.
--
-- Vectors from different models are not comparable. Retrieval only uses
-- chunks embedded by the configured model (NVIDIA_EMBED_MODEL), and the
-- server's re-embed job updates the rest. Existing vectors came from
-- nvidia/nv-embedqa-e5-v5 (retired by NVIDIA on 2026-08-25).
--
-- Additive and backward-compatible: code that does not know the column keeps
-- working; rows it inserts get NULL and are re-embedded later.

alter table public.note_chunks add column embedding_model text;

update public.note_chunks
set embedding_model = 'nvidia/nv-embedqa-e5-v5'
where embedding is not null;

create index idx_note_chunks_embedding_model on public.note_chunks (embedding_model);
