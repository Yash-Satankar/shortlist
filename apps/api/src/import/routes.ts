import express, { Router } from 'express';
import { z } from 'zod';
import { requireSession } from '../auth/middleware';
import type { Db } from '../db/client';
import { badRequest, parse } from '../lib/http';
import { commitImport, planImport } from './service';
import { parseTrackerWorkbook } from './tracker-xlsx';

const querySchema = z.object({
  commit: z.enum(['true', 'false']).default('false'),
  fileName: z.string().trim().max(200).default('tracker.xlsx'),
});

/**
 * POST /api/import/tracker-xlsx           dry run: preview counts + problem rows, writes nothing
 * POST /api/import/tracker-xlsx?commit=true   import (idempotent)
 * Body: the raw .xlsx bytes. Web app only (needs a real session).
 */
export function importRouter(db: Db): Router {
  const router = Router();

  router.post(
    '/tracker-xlsx',
    requireSession,
    express.raw({ type: () => true, limit: '5mb' }),
    async (req, res) => {
      const { commit, fileName } = parse(querySchema, req.query);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('Upload the .xlsx file as the request body');

      let parsed;
      try {
        parsed = await parseTrackerWorkbook(req.body);
      } catch {
        throw badRequest('Could not read that file as an .xlsx workbook');
      }

      const plan = commit === 'true' ? await commitImport(db, req.auth!.userId, parsed, fileName) : await planImport(db, req.auth!.userId, parsed);
      res.json({ committed: commit === 'true', ...plan });
    },
  );

  return router;
}
