import { Router } from 'express';
import { z } from 'zod';
import type { Db } from '../db/client';
import { parse } from '../lib/http';
import { getProfile, updateProfile } from './service';

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

  return router;
}
