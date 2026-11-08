// One-off: copy every Storage object from the source project to the target.
// Reads "bucket<TAB>name<TAB>mimetype" lines on stdin. Secrets come from env and are never printed.
import { createInterface } from 'node:readline';

const { SOURCE_URL, TARGET_URL, SOURCE_SERVICE_ROLE_KEY, TARGET_SERVICE_ROLE_KEY } = process.env;
for (const [k, v] of Object.entries({ SOURCE_URL, TARGET_URL, SOURCE_SERVICE_ROLE_KEY, TARGET_SERVICE_ROLE_KEY })) {
  if (!v) { console.error(`missing ${k}`); process.exit(1); }
}
const auth = key => ({ Authorization: `Bearer ${key}`, apikey: key });
const path = (bucket, name) => `${encodeURIComponent(bucket)}/${name.split('/').map(encodeURIComponent).join('/')}`;

let copied = 0;
let failed = 0;
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const [bucket, name, mime] = line.split('\t');
  try {
    const src = await fetch(`${SOURCE_URL}/storage/v1/object/${path(bucket, name)}`, { headers: auth(SOURCE_SERVICE_ROLE_KEY) });
    if (!src.ok) throw new Error(`download ${src.status}`);
    const body = Buffer.from(await src.arrayBuffer());
    const dst = await fetch(`${TARGET_URL}/storage/v1/object/${path(bucket, name)}`, {
      method: 'POST',
      headers: { ...auth(TARGET_SERVICE_ROLE_KEY), 'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'true' },
      body,
    });
    if (!dst.ok) throw new Error(`upload ${dst.status} ${(await dst.text()).slice(0, 200)}`);
    copied++;
  } catch (e) {
    failed++;
    console.error(`FAILED ${bucket}/<object ${copied + failed}>: ${e.message}`);
  }
}
console.log(`storage objects copied=${copied} failed=${failed}`);
process.exit(failed ? 1 : 0);
