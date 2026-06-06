import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const NOTES_BUCKET       = "learnit-notes";
export const SUBMISSIONS_BUCKET = "learnit-submissions";
const SIGNED_URL_TTL            = 3600;

export const supabaseAdmin: SupabaseClient = createClient(
  process.env.SUPABASE_URL       ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function uploadToStorage(
  bucket: string,
  objectPath: string,
  buffer: Buffer,
  mimetype: string
): Promise<string> {
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(objectPath, buffer, { contentType: mimetype, upsert: true });
  if (error) {
    console.error(`[Storage] upload FAILED (${bucket}/${objectPath})`, {
      message: error.message,
      name: (error as any).name ?? "StorageError",
      statusCode: (error as any).statusCode,
    });
    throw new Error(`Storage upload failed: ${error.message}`);
  }
  console.log(`[Storage] uploaded → ${bucket}/${objectPath}`);
  return objectPath;
}

export async function getSignedUrl(
  bucket: string,
  objectPath: string,
  ttl = SIGNED_URL_TTL
): Promise<string | null> {
  if (!objectPath) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .createSignedUrl(objectPath, ttl);
  if (error) {
    console.error(`[Storage] signed URL error (${bucket}/${objectPath}):`, error.message);
    return null;
  }
  return data.signedUrl;
}

export async function downloadFromStorage(
  bucket: string,
  objectPath: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!objectPath) return null;
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(objectPath);
  if (error || !data) {
    console.error(`[Storage] download error (${bucket}/${objectPath}):`, error?.message);
    return null;
  }
  const buf = Buffer.from(await data.arrayBuffer());
  return { buffer: buf, contentType: data.type || "application/octet-stream" };
}

export async function deleteFromStorage(bucket: string, objectPath: string): Promise<void> {
  if (!objectPath) return;
  const { error } = await supabaseAdmin.storage.from(bucket).remove([objectPath]);
  if (error) console.error(`[Storage] delete error (${bucket}/${objectPath}):`, error.message);
  else        console.log(`[Storage] deleted ${bucket}/${objectPath}`);
}

export async function checkStorageConnectivity(): Promise<void> {
  const testKey = `_healthcheck/${Date.now()}.txt`;
  try {
    const { error: upErr } = await supabaseAdmin.storage
      .from(NOTES_BUCKET)
      .upload(testKey, Buffer.from("ping"), { contentType: "text/plain", upsert: true });
    if (upErr) throw upErr;
    await supabaseAdmin.storage.from(NOTES_BUCKET).remove([testKey]);
    console.log("[Storage] connectivity OK — learnit-notes bucket reachable");
  } catch (e: any) {
    console.error(
      "[Storage] CONNECTIVITY FAIL — check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      { message: e.message, name: e.name, statusCode: e.statusCode }
    );
  }
}
