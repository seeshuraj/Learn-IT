/**
 * Does a file's content match the type it was uploaded as? Uploads are typed
 * by the browser from the file name, so a renamed file (an HTML page saved as
 * ".pdf", a program as ".zip") would otherwise be stored and served under a
 * type it isn't. Checks the first bytes only; pass at least 4 KB for text.
 */

const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));

const isPdf = (b: Uint8Array) => starts(b, ascii('%PDF-'));
const isZip = (b: Uint8Array) => starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06]);
const isOle = (b: Uint8Array) => starts(b, [0xd0, 0xcf, 0x11, 0xe0]);
const isPng = (b: Uint8Array) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const isJpeg = (b: Uint8Array) => starts(b, [0xff, 0xd8, 0xff]);
const isGif = (b: Uint8Array) => starts(b, ascii('GIF87a')) || starts(b, ascii('GIF89a'));
const isWebp = (b: Uint8Array) => starts(b, ascii('RIFF')) && starts(b, ascii('WEBP'), 8);
/** Text: no NUL bytes and no other control bytes apart from tab, newline, carriage return and form feed. */
const isText = (b: Uint8Array) => b.length > 0 && b.every(v => v >= 0x20 || v === 0x09 || v === 0x0a || v === 0x0d || v === 0x0c || v === 0x1b);

const CHECKS: Record<string, (b: Uint8Array) => boolean> = {
  'application/pdf': isPdf,
  'application/zip': isZip,
  'application/x-zip-compressed': isZip,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': isZip,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': isZip,
  'application/vnd.ms-excel': b => isOle(b) || isText(b),   // browsers also label .csv this way
  'image/png': isPng,
  'image/jpeg': isJpeg,
  'image/webp': isWebp,
  'image/gif': isGif,
  'text/plain': isText,
  'text/csv': isText,
};

/** True when the first bytes fit the declared type; false for any type not listed. */
export function contentMatchesType(head: Uint8Array, mime: string): boolean {
  const check = CHECKS[String(mime).toLowerCase().split(';')[0].trim()];
  return !!check && check(head.subarray(0, 4096));
}
