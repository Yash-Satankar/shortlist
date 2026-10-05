import { Router } from 'express';
import { z } from 'zod';
import { searchCompanies } from '../companies/service';
import { AUTO_ONLY, resolveSource, USER_ONLY, USER_OR_AUTO } from '../auth/intent';
import { detectedSubmissionSchema, recordDetectedSubmission } from './detected';
import { requireAuth } from '../auth/middleware';
import type { Db } from '../db/client';
import { parse } from '../lib/http';
import { getStats } from '../stats/service';
import { getFollowUps } from './follow-ups';
import {
  answersReplaceSchema,
  contactSchema,
  contactUpdateSchema,
  createApplicationSchema,
  duplicateCheckSchema,
  eventEditSchema,
  jdSchema,
  listQuerySchema,
  reviewDecisionSchema,
  statusChangeSchema,
  updateApplicationSchema,
} from './schemas';
import {
  addContact,
  addJobDescription,
  createApplication,
  deleteApplication,
  deleteContact,
  findDuplicateMatches,
  getApplication,
  getJobDescription,
  listApplications,
  dismissGhostSuggestion,
  replaceAnswers,
  serializeEvent,
  updateApplication,
  updateContact,
} from './service';
import { editEvent, listPendingReviews, proposeStatus, reviewEvent, undoEvent } from './status';

const uuid = (value: unknown) => parse(z.uuid(), value);

export function applicationsRouter(db: Db): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await listApplications(db, req.auth!.userId, parse(listQuerySchema, req.query)));
  });

  router.post('/', async (req, res) => {
    const input = parse(createApplicationSchema, req.body);
    // One-click save (user) or auto-create from a detected "application submitted" page (auto).
    const result = await createApplication(db, req.auth!.userId, input, resolveSource(req, USER_OR_AUTO, input.via));
    res.status(201).json(result);
  });

  // The extension saw a platform's "application submitted" confirmation (automatic signal only).
  router.post('/detected-submission', async (req, res) => {
    resolveSource(req, AUTO_ONLY);
    res.json(await recordDetectedSubmission(db, req.auth!.userId, parse(detectedSubmissionSchema, req.body)));
  });

  router.post('/check-duplicates', async (req, res) => {
    const input = parse(duplicateCheckSchema, req.body);
    res.json({ matches: await findDuplicateMatches(db, req.auth!.userId, input) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ application: await getApplication(db, req.auth!.userId, uuid(req.params.id)) });
  });

  router.patch('/:id', async (req, res) => {
    resolveSource(req, USER_ONLY);
    const input = parse(updateApplicationSchema, req.body);
    res.json({ application: await updateApplication(db, req.auth!.userId, uuid(req.params.id), input) });
  });

  router.delete('/:id', async (req, res) => {
    resolveSource(req, USER_ONLY);
    await deleteApplication(db, req.auth!.userId, uuid(req.params.id));
    res.status(204).end();
  });

  // ---- status timeline
  router.post('/:id/status', async (req, res) => {
    const input = parse(statusChangeSchema, req.body);
    // Popup status change (user) or a status read off the page (auto, automatic rules).
    const source = resolveSource(req, USER_OR_AUTO);
    const result = await proposeStatus(db, {
      userId: req.auth!.userId,
      applicationId: uuid(req.params.id),
      status: input.status,
      source,
      confidence: source === 'extension_auto' ? input.confidence : undefined,
      note: input.note,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
    });
    res.json({
      decision: result.decision,
      application: await getApplication(db, req.auth!.userId, uuid(req.params.id)),
    });
  });

  router.post('/:id/events/:eventId/undo', async (req, res) => {
    resolveSource(req, USER_ONLY);
    const id = uuid(req.params.id);
    await undoEvent(db, req.auth!.userId, id, uuid(req.params.eventId));
    res.json({ application: await getApplication(db, req.auth!.userId, id) });
  });

  router.post('/:id/events/:eventId/review', async (req, res) => {
    resolveSource(req, USER_ONLY);
    const id = uuid(req.params.id);
    const { decision } = parse(reviewDecisionSchema, req.body);
    await reviewEvent(db, req.auth!.userId, id, uuid(req.params.eventId), decision);
    res.json({ application: await getApplication(db, req.auth!.userId, id) });
  });

  router.patch('/:id/events/:eventId', async (req, res) => {
    resolveSource(req, USER_ONLY);
    const id = uuid(req.params.id);
    await editEvent(db, req.auth!.userId, id, uuid(req.params.eventId), parse(eventEditSchema, req.body));
    res.json({ application: await getApplication(db, req.auth!.userId, id) });
  });

  // ---- ghost suggestion "Not yet" (stored per application, so it holds on every device)
  router.post('/:id/ghost/dismiss', async (req, res) => {
    resolveSource(req, USER_ONLY);
    const dismissedAt = await dismissGhostSuggestion(db, req.auth!.userId, uuid(req.params.id));
    res.json({ dismissedAt });
  });

  // ---- JD snapshots
  router.post('/:id/jd', async (req, res) => {
    const id = uuid(req.params.id);
    const source = resolveSource(req, USER_OR_AUTO);
    const { created } = await addJobDescription(db, req.auth!.userId, id, parse(jdSchema, req.body), source);
    res.status(created ? 201 : 200).json({ created, application: await getApplication(db, req.auth!.userId, id) });
  });

  router.get('/:id/jd/:jdId', async (req, res) => {
    res.json({ jd: await getJobDescription(db, req.auth!.userId, uuid(req.params.id), uuid(req.params.jdId)) });
  });

  // ---- screening Q&A submitted for this application
  router.put('/:id/answers', async (req, res) => {
    resolveSource(req, USER_ONLY);
    const id = uuid(req.params.id);
    await replaceAnswers(db, req.auth!.userId, id, parse(answersReplaceSchema, req.body).answers);
    res.json({ application: await getApplication(db, req.auth!.userId, id) });
  });

  // ---- recruiter / contacts
  router.post('/:id/contacts', async (req, res) => {
    resolveSource(req, USER_ONLY);
    const contact = await addContact(db, req.auth!.userId, uuid(req.params.id), parse(contactSchema, req.body));
    res.status(201).json({ contact });
  });

  return router;
}

export function contactsRouter(db: Db): Router {
  const router = Router();
  router.patch('/:id', async (req, res) => {
    res.json({ contact: await updateContact(db, req.auth!.userId, uuid(req.params.id), parse(contactUpdateSchema, req.body)) });
  });
  router.delete('/:id', async (req, res) => {
    await deleteContact(db, req.auth!.userId, uuid(req.params.id));
    res.status(204).end();
  });
  return router;
}

export function trackerRouter(db: Db): Router {
  const router = Router();
  router.get('/follow-ups', requireAuth, async (req, res) => {
    res.json(await getFollowUps(db, req.auth!.userId));
  });
  router.get('/stats', requireAuth, async (req, res) => {
    res.json(await getStats(db, req.auth!.userId));
  });
  router.get('/reviews', requireAuth, async (req, res) => {
    const rows = await listPendingReviews(db, req.auth!.userId);
    res.json({ items: rows.map(({ event, ...rest }) => ({ event: serializeEvent(event), ...rest })) });
  });
  router.get('/companies', requireAuth, async (req, res) => {
    const q = parse(z.string().max(200).default(''), req.query.q);
    res.json({ items: await searchCompanies(db, req.auth!.userId, q) });
  });
  return router;
}
