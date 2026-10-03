import { normalizeQuestion, PROFILE_ANSWER_FIELDS, profileFieldForQuestion } from '@jt/shared';
import { and, asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { isUniqueViolation, type Db } from '../db/client';
import { answerLibrary } from '../db/schema';
import { conflict, HttpError, notFound, parse } from '../lib/http';
import { getProfile, profileAnswerItems } from '../profile/service';

/**
 * My standard screening answers, reused to prefill each application's Q&A.
 * The list merges two origins:
 *  - 'profile': generated from profile fields (notice period, CTC, ...). Read-only here.
 *  - 'library': free-form entries stored in answer_library.
 * Questions that belong to a profile field can't be stored as library copies.
 */

const itemSchema = z.object({
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(5000),
  category: z
    .string()
    .trim()
    .max(100)
    .transform((v) => v || null)
    .nullish(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

const serialize = ({ userId: _u, questionNormalized: _q, isDemo: _d, ...item }: typeof answerLibrary.$inferSelect) => ({
  ...item,
  origin: 'library' as const,
});

function rejectProfileQuestion(question: string | undefined) {
  if (!question) return;
  const field = profileFieldForQuestion(question);
  if (field) {
    const label = PROFILE_ANSWER_FIELDS.find((f) => f.key === field)!.question;
    throw new HttpError(409, `"${label}" comes from your profile; edit it there`, 'profile_field', { profileField: field });
  }
}

export function answerLibraryRouter(db: Db): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const [items, profile] = await Promise.all([
      db
        .select()
        .from(answerLibrary)
        .where(eq(answerLibrary.userId, req.auth!.userId))
        .orderBy(asc(answerLibrary.sortOrder), asc(answerLibrary.question)),
      getProfile(db, req.auth!.userId),
    ]);
    res.json({ items: [...profileAnswerItems(profile), ...items.map(serialize)] });
  });

  router.post('/', async (req, res) => {
    const input = parse(itemSchema, req.body);
    rejectProfileQuestion(input.question);
    try {
      const [item] = await db
        .insert(answerLibrary)
        .values({ ...input, userId: req.auth!.userId, questionNormalized: normalizeQuestion(input.question) })
        .returning();
      res.status(201).json({ item: serialize(item!) });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('That question is already in your answer library');
      throw err;
    }
  });

  router.patch('/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const input = parse(itemSchema.partial(), req.body);
    rejectProfileQuestion(input.question);
    try {
      const [item] = await db
        .update(answerLibrary)
        .set({ ...input, ...(input.question ? { questionNormalized: normalizeQuestion(input.question) } : {}) })
        .where(and(eq(answerLibrary.id, id), eq(answerLibrary.userId, req.auth!.userId)))
        .returning();
      if (!item) throw notFound('Answer not found');
      res.json({ item: serialize(item) });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('That question is already in your answer library');
      throw err;
    }
  });

  router.delete('/:id', async (req, res) => {
    const id = parse(z.uuid(), req.params.id);
    const deleted = await db
      .delete(answerLibrary)
      .where(and(eq(answerLibrary.id, id), eq(answerLibrary.userId, req.auth!.userId)))
      .returning({ id: answerLibrary.id });
    if (!deleted.length) throw notFound('Answer not found');
    res.status(204).end();
  });

  return router;
}
