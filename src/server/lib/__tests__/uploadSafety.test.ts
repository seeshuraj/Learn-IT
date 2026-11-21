import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { contentMatchesType } from '../fileSignature.js';
import { readZipEntries } from '../safeZip.js';
import { checkSubmissionFiles, SUBMISSION_LIMITS } from '../submissionLimits.js';

const bytes = (s: string) => Buffer.from(s, 'latin1');
const MB = 1024 * 1024;

test('a file must look like the type it claims to be', () => {
  assert.equal(contentMatchesType(bytes('%PDF-1.7\n'), 'application/pdf'), true);
  assert.equal(contentMatchesType(bytes('<html><script>x</script>'), 'application/pdf'), false);
  assert.equal(contentMatchesType(bytes('PK\x03\x04rest'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true);
  assert.equal(contentMatchesType(bytes('PK\x03\x04rest'), 'application/zip'), true);
  assert.equal(contentMatchesType(bytes('MZ\x90\x00'), 'application/zip'), false);
  assert.equal(contentMatchesType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), true);
  assert.equal(contentMatchesType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), true);
  assert.equal(contentMatchesType(bytes('RIFF\x00\x00\x00\x00WEBPVP8 '), 'image/webp'), true);
  assert.equal(contentMatchesType(bytes('Answer to Q1: normal forms…'), 'text/plain'), true);
  assert.equal(contentMatchesType(bytes('date,course\n01/12/2026,CS'), 'text/csv'), true);
  assert.equal(contentMatchesType(Buffer.from([0x41, 0x00, 0x42]), 'text/plain'), false, 'binary is not text');
  assert.equal(contentMatchesType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1]), 'application/vnd.ms-excel'), true);
  assert.equal(contentMatchesType(bytes('%PDF-1.4'), 'application/x-msdownload'), false, 'types not on the list never match');
});

test('submission limits: at most 5 files, 25 MB each and 25 MB in total', () => {
  const pdf = (size: number, name = 'a.pdf') => ({ name, size, type: 'application/pdf' });
  assert.equal(checkSubmissionFiles([pdf(10 * MB), pdf(10 * MB, 'b.pdf')]), null);
  assert.match(checkSubmissionFiles([pdf(20 * MB), pdf(10 * MB, 'b.pdf')]) ?? '', /25 MB in total/);
  assert.match(checkSubmissionFiles(Array.from({ length: 6 }, (_, i) => pdf(MB, `${i}.pdf`))) ?? '', /at most 5 files/);
  assert.match(checkSubmissionFiles([pdf(26 * MB)]) ?? '', /a.pdf is larger than 25 MB/);
  assert.match(checkSubmissionFiles([{ name: 'x.exe', size: 10, type: 'application/x-msdownload' }]) ?? '', /x.exe: this type of file/);
  assert.match(checkSubmissionFiles([pdf(0)]) ?? '', /a.pdf is empty/);
  assert.match(checkSubmissionFiles([]) ?? '', /at least one file/);
  assert.equal(SUBMISSION_LIMITS.maxTotalBytes, 25 * MB);
});

/** A zip built by hand: each entry stored deflated, with local headers and a central directory. */
function zip(entries: { name: string; data: Buffer; method?: number; flags?: number; claimSize?: number }[]): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const body = method === 8 ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(e.flags ?? 0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(e.claimSize ?? e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(e.flags ?? 0, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(e.claimSize ?? e.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, body); centrals.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('a zip submission opens to the readable files inside it', () => {
  const z = zip([
    { name: 'answers/q1.txt', data: Buffer.from('Q1: BCNF removes anomalies') },
    { name: 'answers/q2.pdf', data: Buffer.from('%PDF-1.4 fake') },
    { name: 'answers/run.exe', data: Buffer.from('MZ') },
    { name: '__MACOSX/._q1.txt', data: Buffer.from('junk') },
    { name: 'answers/', data: Buffer.alloc(0), method: 0 },
  ]);
  const r = readZipEntries(z);
  assert.deepEqual(r.entries.map(e => e.name), ['answers/q1.txt', 'answers/q2.pdf']);
  assert.equal(r.entries[0].data.toString(), 'Q1: BCNF removes anomalies');
  assert.deepEqual(r.skipped, ['answers/run.exe']);
});

test('a zip bomb stops at the limit instead of filling memory', () => {
  const huge = Buffer.alloc(40 * MB, 0x41);                     // compresses to ~40 KB
  const r = readZipEntries(zip([{ name: 'a.txt', data: huge, claimSize: 100 }]), { maxEntryBytes: 5 * MB, maxTotalBytes: 10 * MB });
  assert.equal(r.entries.length, 0);
  assert.match(r.errors.join(' '), /a.txt is too large/);
});

test('total uncompressed size is capped across entries', () => {
  const part = Buffer.alloc(4 * MB, 0x42);
  const r = readZipEntries(zip([1, 2, 3, 4].map(i => ({ name: `p${i}.txt`, data: part }))), { maxEntryBytes: 5 * MB, maxTotalBytes: 10 * MB });
  assert.deepEqual(r.entries.map(e => e.name), ['p1.txt', 'p2.txt']);
  assert.match(r.errors.join(' '), /stopped after 10 MB/);
});

test('encrypted entries, nested zips and broken files are skipped, never thrown', () => {
  const r = readZipEntries(zip([
    { name: 'secret.txt', data: Buffer.from('x'), flags: 1 },
    { name: 'inner.zip', data: Buffer.from('PK\x03\x04') },
  ]));
  assert.equal(r.entries.length, 0);
  assert.deepEqual(r.skipped, ['secret.txt', 'inner.zip']);
  const bad = readZipEntries(Buffer.from('not a zip at all'));
  assert.equal(bad.entries.length, 0);
  assert.match(bad.errors.join(' '), /not a readable zip/);
});
