import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

/** The text of a PDF, NULs removed. Throws when the file can't be read. */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parsed = await pdfParse(buffer);
  return String(parsed.text ?? '').replace(/\x00/g, '');
}
