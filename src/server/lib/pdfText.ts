import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

export interface PdfTextResult {
  /** The text, NULs removed. Empty when nothing could be read (a scan, a broken file). */
  text: string;
  /** Which reader produced the text. */
  engine: 'pdf-parse' | 'pdfjs' | null;
  /** Why a reader failed, as "Name: message" (no file contents). */
  error?: string;
}

type Reader = (data: Uint8Array) => Promise<string>;

/** A copy in its own memory, so no reader ever sees a shared pool or a buffer another call consumed. */
function ownCopy(buffer: Uint8Array): Uint8Array {
  const copy = new Uint8Array(buffer.length);
  copy.set(buffer);
  return copy;
}

const readWithPdfParse: Reader = async data => {
  const parsed = await pdfParse(Buffer.from(data.buffer, data.byteOffset, data.length));
  return String(parsed.text ?? '');
};

const readWithPdfjs: Reader = async data => {
  const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0,
  }).promise;
  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const content = await (await doc.getPage(p)).getTextContent();
      pages.push(content.items.map((i: any) => (i.hasEOL ? `${i.str}\n` : i.str)).join(' '));
    }
    return pages.join('\n');
  } finally {
    await doc.destroy();
  }
};

const hasText = (s: string) => s.replace(/\s/g, '').length >= 20;
const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300);

/**
 * The text of a PDF. Tries pdf-parse first, then pdf.js, and never throws:
 * a file neither can read comes back with empty text and the reason.
 */
export async function readPdfText(
  buffer: Uint8Array,
  readers: { primary?: Reader; fallback?: Reader } = {},
): Promise<PdfTextResult> {
  const errors: string[] = [];
  const attempts: [PdfTextResult['engine'], Reader][] = [
    ['pdf-parse', readers.primary ?? readWithPdfParse],
    ['pdfjs', readers.fallback ?? readWithPdfjs],
  ];
  for (const [engine, read] of attempts) {
    try {
      const text = (await read(ownCopy(buffer))).replace(/\x00/g, '');
      if (hasText(text)) return { text, engine, ...(errors.length ? { error: errors.join(' | ') } : {}) };
      errors.push(`${engine}: no text`);
    } catch (e) {
      errors.push(`${engine}: ${describe(e)}`);
    }
  }
  return { text: '', engine: null, error: errors.join(' | ') };
}

/** The text of a PDF, or '' when it can't be read. */
export async function extractPdfText(buffer: Uint8Array): Promise<string> {
  return (await readPdfText(buffer)).text;
}
