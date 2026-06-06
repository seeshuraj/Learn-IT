import path from "path";
import fs from "fs";
import { createRequire } from "module";

const require   = createRequire(import.meta.url);
const pdfParse  = require("pdf-parse");
const mammoth   = require("mammoth");

export function sanitizeText(t: string): string {
  return t
    .replace(/\x00/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\uFFFD/g, "");
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimetype: string,
  originalname: string
): Promise<string> {
  const ext = path.extname(originalname).toLowerCase();
  try {
    if (ext === ".pdf" || mimetype === "application/pdf") {
      const data = await pdfParse(buffer);
      return sanitizeText(data.text ?? "");
    }
    if (ext === ".docx" || mimetype.includes("wordprocessingml")) {
      const result = await mammoth.extractRawText({ buffer });
      return sanitizeText(result.value ?? "");
    }
    if (ext === ".txt" || mimetype === "text/plain") {
      return sanitizeText(buffer.toString("utf-8"));
    }
    return "";
  } catch (e) {
    console.error("[extractTextFromBuffer] error:", e);
    return "";
  }
}

export async function extractText(filePath: string, mimetype: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".pdf" || mimetype === "application/pdf") {
      const buf  = fs.readFileSync(filePath);
      const data = await pdfParse(buf);
      return sanitizeText(data.text ?? "");
    }
    if (ext === ".docx" || mimetype.includes("wordprocessingml")) {
      const result = await mammoth.extractRawText({ path: filePath });
      return sanitizeText(result.value ?? "");
    }
    if (ext === ".txt" || mimetype === "text/plain") {
      return sanitizeText(fs.readFileSync(filePath, "utf-8"));
    }
    return "";
  } catch (e) {
    console.error("[extractText] error:", e);
    return "";
  }
}

export function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const words  = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let i = 0;
  while (i < words.length) {
    chunks.push(words.slice(i, i + chunkSize).join(" "));
    i += chunkSize - overlap;
  }
  return chunks.filter(c => c.trim().length > 20);
}
