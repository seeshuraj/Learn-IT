/**
 * Note retrieval for the tutor, ranked inside Postgres with pgvector.
 *
 * Only the top-K chunks for one module leave the database, so memory and
 * network per question stay constant however large a module or how many
 * students ask at once. See migration 20261113120000_pgvector_note_search.sql.
 */
import { studentVisibleNotes } from './access.js';

interface Queryable { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> }

export interface SourcedChunk { text: string; source: string; score: number }

/** pgvector's text format; non-finite values would be rejected by the cast. */
export function toVectorLiteral(v: number[]): string {
  if (!v.length || v.some(x => !Number.isFinite(x))) throw new Error('invalid embedding vector');
  return `[${v.join(',')}]`;
}

export async function searchModuleChunks(
  db: Queryable,
  args: { moduleId: number | string; model: string; queryVector: number[]; topK?: number; visibleToStudentId?: number },
): Promise<SourcedChunk[]> {
  const topK = Math.min(Math.max(1, Math.floor(args.topK ?? 5)), 20);
  const params: unknown[] = [args.moduleId, args.model, toVectorLiteral(args.queryVector), topK];
  let visibility = '';
  if (args.visibleToStudentId != null) {
    params.push(args.visibleToStudentId);
    visibility = `AND ${studentVisibleNotes('$5')}`;
  }
  const { rows } = await db.query(
    `SELECT nc.chunk_text,
            COALESCE(n.original_name, n.filename) AS source,
            1 - (nc.embedding_vec OPERATOR(extensions.<=>) $3::extensions.halfvec) AS score
     FROM note_chunks nc
     JOIN notes n ON n.id = nc.note_id
     WHERE n.module_id = $1
       AND nc.embedding_model = $2
       AND nc.embedding_vec IS NOT NULL
       ${visibility}
     ORDER BY nc.embedding_vec OPERATOR(extensions.<=>) $3::extensions.halfvec
     LIMIT $4`,
    params,
  );
  return rows.map(r => ({
    text: String(r.chunk_text ?? ''),
    source: String(r.source ?? 'Course notes'),
    score: Number(r.score ?? 0),
  }));
}

/**
 * Inserts a note's chunks in one statement. Chunks without vectors (the
 * embedding call failed) are stored with a NULL model, so the re-embed job
 * picks them up.
 */
export async function insertNoteChunks(
  db: Queryable,
  noteId: number,
  chunks: string[],
  vectors: number[][] | null,
  model: string,
): Promise<void> {
  if (!chunks.length) return;
  if (vectors && vectors.length !== chunks.length) throw new Error('chunk and vector counts differ');
  await db.query(
    `INSERT INTO note_chunks (note_id, chunk_index, chunk_text, embedding_vec, embedding_model)
     SELECT $1, v.idx - 1, v.chunk_text, v.vec::extensions.halfvec, CASE WHEN v.vec IS NULL THEN NULL ELSE $4 END
     FROM unnest($2::text[], $3::text[]) WITH ORDINALITY AS v(chunk_text, vec, idx)`,
    [noteId, chunks, chunks.map((_, i) => (vectors ? toVectorLiteral(vectors[i]) : null)), model],
  );
}
