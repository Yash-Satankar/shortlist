import type { EventSource } from '@jt/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { searchCompanies } from '../companies/service';
import { requireAuth } from '../auth/middleware';
import type { Db } from '../db/client';
import { parse } from '../lib/http';
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
  replaceAnswers,
  updateApplication,
  updateContact,
} from './service';
import { editEvent, listPendingReviews, proposeStatus, reviewEvent, undoEvent } from './status';

const uuid = (value: unknown) => parse(z.uuid(), value);

/** Requests with an API token come from the extension; everything else is the user in the web app. */
const requestSource = (req: Request, fallback: EventSource = 'manual'): EventSource =>
  req.auth!.via === 'token' ? 'extension' : fallback;

export function applicationsRouter(db: Db): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(await listApplications(db, req.auth!.userId, parse(listQuerySchema, req.query)));
  });

  router.post('/', async (req, res) => {
    const input = parse(createApplicationSchema, req.body);
    const result = await createApplication(db, req.auth!.userId, input, requestSource(req, input.via));
    res.status(201).json(result);
  });

  router.post('/check-duplicates', async (req, res) => {
    const input = parse(duplicateCheckSchema, req.body);
    res.json({ matches: await findDuplicateMatches(db, req.auth!.userId, input) });
  });

  router.get('/:id', async (req, res) => {
    res.json({ application: await getApplication(db, req.auth!.userId, uuid(req.params.id)) });
  });

  router.patch('/:id', async (req, res) => {
    const input = parse(updateApplicationSchema, req.body);
    res.json({ application: await updateApplication(db, req.auth!.userId, uuid(req.params.id), input) });
  });

  router.delete('/:id', async (req, res) => {
    await deleteApplication(db, req.auth!.userId, uuid(req.params.id));
    res.status(204).end();
  });

  // ---- status timeline
  router.post('/:id/status', async (req, res) => {
    const input = parse(statusChangeSchema, req.body);
    const result = await proposeStatus(db, {
      userId: req.auth!.userId,
      applicationId: uuid(req.params.id),
      status: input.status,
      source: requestSource(req),
      note: input.note,
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
    });
    res.json({
      decision: result.decision,
      application: await getApplication(db, req.auth!.userId, uuid(req.params.id)),
    });
  });

  router.post('/:id/events/:eventId/undo', async (req, res) => {
    const id = uuid(req.params.id);
    await undoEvent(db, req.auth!.userId, id, uuid(req.params.eventId));
    res.json({ application: await getApplication(db, req.auth!.userId, id) });
  });

  router.post('/:id/events/:eventId/review', async (req, res) => {
    const id = uuid(req.params.id);
    const { decision } = parse(reviewDecisionSchema, req.body);
    await reviewEvent(db, req.auth!.userId, id, uuid(req.params.eventId), decision);
    res.json({ application: await getApplication(db, req.auth!.userId, id) });
  });

  router.patch('/:id/events/:eventId', async (req, res) => {
    const id = uuid(req.params.id);
    await editEvent(db, req.auth!.userId, id, uuid(req.params.eventId), parse(eventEditSchema, req.body));
    res.json({ application: await getApplication(db, req.auth!.userId, id) });
  });

  // ---- JD snapshots
  router.post('/:id/jd', async (req, res) => {
    const id = uuid(req.params.id);
    const { created } = await addJobDescription(db, req.auth!.userId, id, parse(jdSchema, req.body), requestSource(req));
    res.status(created ? 201 : 200).json({ created, application: await getApplication(db, req.auth!.userId, id) });
  });

  router.get('/:id/jd/:jdId', async (req, res) => {
    res.json({ jd: await getJobDescription(db, req.auth!.userId, uuid(req.params.id), uuid(req.params.jdId)) });
  });

  // ---- screening Q&A submitted for this application
  router.put('/:id/answers', async (req, res) => {
    const id = uuid(req.params.id);
    await replaceAnswers(db, req.auth!.userId, id, parse(answersReplaceSchema, req.body).answers);
    res.json({ application: await getApplication(db, req.auth!.userId, id) });
  });

  // ---- recruiter / contacts
  router.post('/:id/contacts', async (req, res) => {
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
  router.get('/reviews', requireAuth, async (req, res) => {
    const rows = await listPendingReviews(db, req.auth!.userId);
    res.json({ items: rows.map(({ event: { userId: _u, ...event }, ...rest }) => ({ event, ...rest })) });
  });
  router.get('/companies', requireAuth, async (req, res) => {
    const q = parse(z.string().max(200).default(''), req.query.q);
    res.json({ items: await searchCompanies(db, req.auth!.userId, q) });
  });
  return router;
}
