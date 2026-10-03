import { normalizeQuestion } from '@jt/shared';
import { and, asc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';
import { isUniqueViolation, type Db } from '../db/client';
import { answerLibrary } from '../db/schema';
import { conflict, notFound, parse } from '../lib/http';

/** My standard screening answers, reused to prefill each application's Q&A. */

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

const serialize = ({ userId: _u, questionNormalized: _q, ...item }: typeof answerLibrary.$inferSelect) => item;

export function answerLibraryRouter(db: Db): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const items = await db
      .select()
      .from(answerLibrary)
      .where(eq(answerLibrary.userId, req.auth!.userId))
      .orderBy(asc(answerLibrary.sortOrder), asc(answerLibrary.question));
    res.json({ items: items.map(serialize) });
  });

  router.post('/', async (req, res) => {
    const input = parse(itemSchema, req.body);
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
