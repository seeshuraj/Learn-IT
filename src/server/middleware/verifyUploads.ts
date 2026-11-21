import type { Request, Response, NextFunction } from 'express';
import { contentMatchesType } from '../lib/fileSignature.js';

/**
 * After multer: refuse any uploaded file whose bytes don't match its declared
 * type (a page renamed ".pdf", a program renamed ".zip"). Runs before the
 * handler stores or parses anything.
 */
export function verifyUploadedContent(req: Request, res: Response, next: NextFunction) {
  const r = req as any;
  const files: Express.Multer.File[] = [
    ...(r.file ? [r.file] : []),
    ...(Array.isArray(r.files) ? r.files : r.files ? Object.values(r.files).flat() as Express.Multer.File[] : []),
  ];
  const bad = files.find(f => f.buffer && !contentMatchesType(f.buffer, f.mimetype));
  if (bad) {
    return res.status(415).json({
      error: `${bad.originalname} doesn't look like a ${bad.mimetype} file. Save it again in that format and re-upload.`,
      field: 'file',
    });
  }
  next();
}
