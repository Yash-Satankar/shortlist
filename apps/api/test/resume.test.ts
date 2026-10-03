import JSZip from 'jszip';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { closeDb, getDb } from '../src/db/client';
import { detectResumeKind, extractResumeText, tidy } from '../src/profile/resume';
import { createUser } from '../src/users/service';
import { ORIGIN, resetDb } from './helpers';

/** Minimal single-page PDF with real text objects and a correct xref table. */
function makePdf(lines: string[]): Buffer {
  const content = `BT /F1 14 Tf 72 720 Td ${lines.map((l, i) => `${i ? '0 -20 Td ' : ''}(${l.replace(/[()\\]/g, '\\$&')}) Tj`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Minimal DOCX (Office Open XML) with one paragraph per line. */
async function makeDocx(paragraphs: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
      .join('')}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('resume extraction', () => {
  it('extracts text from a PDF', async () => {
    const r = await extractResumeText(makePdf(['Jane Doe', 'Node.js Developer', 'Express, PostgreSQL, Redis']));
    expect(r.kind).toBe('pdf');
    expect(r.pages).toBe(1);
    expect(r.text).toContain('Jane Doe');
    expect(r.text).toContain('Node.js Developer');
    expect(r.text).toContain('PostgreSQL');
  });

  it('extracts text from a DOCX, one line per paragraph', async () => {
    const r = await extractResumeText(await makeDocx(['Jane Doe', 'Backend Engineer', 'Built REST APIs']));
    expect(r.kind).toBe('docx');
    expect(r.text.split('\n').filter(Boolean)).toEqual(['Jane Doe', 'Backend Engineer', 'Built REST APIs']);
  });

  it('sniffs the type from content, not the name, and rejects other files', async () => {
    expect(detectResumeKind(makePdf(['x']))).toBe('pdf');
    expect(detectResumeKind(await makeDocx(['x']))).toBe('docx');
    expect(detectResumeKind(Buffer.from('plain text'))).toBeNull();
    await expect(extractResumeText(Buffer.from('MZ fake exe'))).rejects.toThrow(/PDF or DOCX/);
  });

  it('tidies whitespace but keeps paragraphs', () => {
    expect(tidy('A  \t B\r\n\r\n\r\n\r\nC \n  D')).toBe('A B\n\nC\nD');
  });
});

describe('POST /api/profile/resume', () => {
  const db = getDb();
  const app = createApp({ db });

  beforeEach(async () => {
    await resetDb();
    await createUser(db, { email: 'asha@example.com', password: 'correct horse battery' });
  });
  afterAll(closeDb);

  it('saves the extracted text to the profile, editable afterwards', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'asha@example.com', password: 'correct horse battery' }).expect(200);

    const res = await agent
      .post('/api/profile/resume')
      .set('Origin', ORIGIN)
      .set('Content-Type', 'application/pdf')
      .send(makePdf(['Jane Doe', 'Node.js Developer']));
    expect(res.status).toBe(200);
    expect(res.body.extracted).toMatchObject({ kind: 'pdf', pages: 1 });
    expect(res.body.profile.resumeText).toContain('Node.js Developer');
    expect(res.body.profile.resumeUpdatedAt).toBeTruthy();

    const edited = await agent.patch('/api/profile').set('Origin', ORIGIN).send({ resumeText: 'Edited resume' });
    expect(edited.body.profile.resumeText).toBe('Edited resume');

    const bad = await agent.post('/api/profile/resume').set('Origin', ORIGIN).set('Content-Type', 'application/octet-stream').send(Buffer.from('nope'));
    expect(bad.status).toBe(400);
  });
});
