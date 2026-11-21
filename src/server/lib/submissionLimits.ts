/** What one assignment submission may hold. The storage bucket enforces the per-file size too. */
export const SUBMISSION_LIMITS = {
  maxFiles: 5,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 25 * 1024 * 1024,
  types: [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'image/png',
    'image/jpeg',
    'application/zip',
    'application/x-zip-compressed',
  ],
} as const;

export interface PlannedFile { name: string; size: number; type: string }

/** Why these files can't be one submission, in words for the student; null when they can. */
export function checkSubmissionFiles(files: PlannedFile[]): string | null {
  const L = SUBMISSION_LIMITS;
  if (!files.length) return 'Choose at least one file.';
  if (files.length > L.maxFiles) return `A submission can have at most ${L.maxFiles} files.`;
  for (const f of files) {
    if (!(L.types as readonly string[]).includes(String(f.type).toLowerCase())) {
      return `${f.name}: this type of file can't be submitted. Use PDF, Word (.docx), Excel (.xlsx), text, PNG, JPEG or a .zip of those.`;
    }
    if (!(f.size > 0)) return `${f.name} is empty.`;
    if (f.size > L.maxFileBytes) return `${f.name} is larger than ${L.maxFileBytes / 1048576} MB.`;
  }
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > L.maxTotalBytes) {
    return `These files come to ${(total / 1048576).toFixed(1)} MB. A submission can be ${L.maxTotalBytes / 1048576} MB in total; compress scans or split the work.`;
  }
  return null;
}
