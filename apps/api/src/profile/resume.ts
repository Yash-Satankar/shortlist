import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { badRequest } from '../lib/http';

/**
 * Resume → plain text. The file is only read in memory; nothing but the extracted
 * text is stored (on the profile, where it can be edited).
 */

export type ResumeKind = 'pdf' | 'docx';

/** Canonical MIME for the sniffed type (the browser's claim isn't trusted). */
export const RESUME_MIME: Record<ResumeKind, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Original file name from the X-File-Name header: URL-decoded, path stripped, length-capped. */
export function cleanFileName(header: string | undefined): string | null {
  if (!header) return null;
  let name = header;
  try {
    name = decodeURIComponent(header);
  } catch {
    // keep the raw header
  }
  // eslint-disable-next-line no-control-regex -- strip control characters from an uploaded file name
  name = name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f]/g, '').trim();
  return name ? name.slice(0, 255) : null;
}

/** Sniffs the real type from magic bytes rather than trusting the file name/content-type. */
export function detectResumeKind(buf: Buffer): ResumeKind | null {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  // DOCX is a ZIP whose entries include word/document.xml
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from('word/'))) return 'docx';
  return null;
}

export async function extractResumeText(buf: Buffer): Promise<{ kind: ResumeKind; text: string; pages?: number }> {
  const kind = detectResumeKind(buf);
  if (!kind) throw badRequest('Upload a PDF or DOCX file');

  try {
    if (kind === 'pdf') {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { totalPages, text } = await extractText(pdf, { mergePages: true });
      return { kind, text: tidy(text), pages: totalPages };
    }
    const { value } = await mammoth.extractRawText({ buffer: buf });
    return { kind, text: tidy(value) };
  } catch {
    throw badRequest(`Could not read that ${kind.toUpperCase()} file`);
  }
}

/** Normalizes whitespace but keeps paragraph breaks, so the text stays editable. */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
