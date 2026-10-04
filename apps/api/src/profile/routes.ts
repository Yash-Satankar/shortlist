import express, { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/client';
import { requireSession } from '../auth/middleware';
import { badRequest, parse } from '../lib/http';
import { cleanFileName, extractResumeText, RESUME_MIME } from './resume';
import { getProfile, saveUploadedResume, updateProfile } from './service';

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullish();

export const profilePatchSchema = z
  .object({
    fullName: text(200),
    headline: text(300),
    totalExperienceYears: z.number().min(0).max(60).nullable(),
    noticePeriodDays: z.number().int().min(0).max(365).nullable(),
    relocation: text(300),
    relocationWilling: z.boolean().nullable(),
    relocationPreference: text(300),
    currentLocation: text(300),
    currentCtc: text(100),
    expectedCtc: text(100),
    resumeText: text(100_000),
  })
  .partial();

export function profileRouter(db: Db): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json({ profile: await getProfile(db, req.auth!.userId) });
  });

  router.patch('/', async (req, res) => {
    const patch = parse(profilePatchSchema, req.body);
    res.json({ profile: await updateProfile(db, req.auth!.userId, patch) });
  });

  // Raw PDF/DOCX body → extracted text saved as the profile's resume (editable afterwards).
  router.post('/resume', requireSession, express.raw({ type: () => true, limit: '5mb' }), async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('Upload the resume file as the request body');
    const { kind, text, pages } = await extractResumeText(req.body);
    if (!text) throw badRequest('No text found in that file (is it a scanned image?)');
    const profile = await saveUploadedResume(db, req.auth!.userId, {
      text,
      fileName: cleanFileName(req.get('x-file-name')),
      size: req.body.length,
      mimeType: RESUME_MIME[kind],
    });
    res.json({ profile, extracted: { kind, pages, characters: text.length } });
  });

  return router;
}
