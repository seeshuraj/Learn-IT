import { inflateRawSync } from 'node:zlib';

/**
 * Reads a zip submission in memory so AI grading can see the files inside,
 * without trusting the archive: sizes are capped while inflating (a "zip
 * bomb" stops at the cap, whatever its headers claim), encrypted entries and
 * nested archives are skipped, only readable types are returned, and nothing
 * is written to disk. Never throws.
 */

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}
export interface ZipReadResult {
  entries: { name: string; data: Buffer }[];
  /** Entries left out on purpose: unreadable types, encrypted, nested archives. */
  skipped: string[];
  /** Why reading stopped or an entry failed. */
  errors: string[];
}

const DEFAULTS: ZipLimits = { maxEntries: 50, maxEntryBytes: 10 * 1024 * 1024, maxTotalBytes: 20 * 1024 * 1024 };
const READABLE = /\.(pdf|docx|txt)$/i;   // what extractTextFromBuffer reads
const JUNK = /(^|\/)(__MACOSX\/|\.DS_Store$|\._)/;
const MB = (n: number) => `${Math.round(n / 1048576)} MB`;

export function readZipEntries(buf: Buffer, limits: Partial<ZipLimits> = {}): ZipReadResult {
  const L = { ...DEFAULTS, ...limits };
  const out: ZipReadResult = { entries: [], skipped: [], errors: [] };
  try {
    // End of central directory: last 22..(22+65535) bytes.
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('no end record');
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    let total = 0;

    for (let n = 0; n < count && n < L.maxEntries; n++) {
      if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
      const flags = buf.readUInt16LE(p + 8);
      const method = buf.readUInt16LE(p + 10);
      const csize = buf.readUInt32LE(p + 20);
      const nameLen = buf.readUInt16LE(p + 28);
      const extraLen = buf.readUInt16LE(p + 30);
      const commentLen = buf.readUInt16LE(p + 32);
      const local = buf.readUInt32LE(p + 42);
      const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;

      if (name.endsWith('/') || JUNK.test(name)) continue;
      if ((flags & 1) || /\.(zip|rar|7z|gz|tar)$/i.test(name) || !READABLE.test(name)) { out.skipped.push(name); continue; }
      if (total >= L.maxTotalBytes) { out.errors.push(`stopped after ${MB(L.maxTotalBytes)} of files`); break; }

      if (buf.readUInt32LE(local) !== 0x04034b50) { out.errors.push(`${name} could not be read`); continue; }
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const body = buf.subarray(start, start + csize);
      const room = Math.min(L.maxEntryBytes, L.maxTotalBytes - total);
      let data: Buffer | null = null;
      let tooBig = false;
      try {
        if (method === 0) data = body;
        else if (method === 8) data = inflateRawSync(body, { maxOutputLength: room + 1 });
        else { out.skipped.push(name); continue; }
      } catch (e: any) {
        if (e?.code !== 'ERR_BUFFER_TOO_LARGE') { out.errors.push(`${name} could not be read`); continue; }
        tooBig = true;
      }
      if (tooBig || !data || data.length > room) {
        // Over the total's remaining room: stop. Over a single file's cap: skip it.
        if (room < L.maxEntryBytes) { out.errors.push(`stopped after ${MB(L.maxTotalBytes)} of files`); break; }
        out.errors.push(`${name} is too large to read`);
        continue;
      }
      total += data.length;
      out.entries.push({ name, data });
    }
  } catch {
    out.errors.push('the file is not a readable zip');
  }
  return out;
}
