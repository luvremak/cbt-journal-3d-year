import type { Router } from 'express';
import { currentUser } from '../../http/middleware/auth.js';
import { parseBody } from '../../http/validate.js';
import { parsePage } from '../../lib/pagination.js';
import { createEntryBody, toEntryDto, toTherapistEntryDto } from './entry-schemas.js';
import type { EntryService } from './entry-service.js';

export function mountClientEntryRoutes(router: Router, entries: EntryService): void {
  router.post('/entries', async (req, res) => {
    const input = parseBody(createEntryBody, req.body);
    const entry = await entries.create(currentUser(res), input);
    res.status(201).json(toEntryDto(entry));
  });

  router.get('/entries', async (req, res) => {
    const list = await entries.listForClient(currentUser(res), parsePage(req.query));
    res.json(list.map(toEntryDto));
  });

  router.get('/entries/:id', async (req, res) => {
    res.json(toEntryDto(await entries.getForClient(currentUser(res), req.params.id)));
  });

  router.delete('/entries/:id', async (req, res) => {
    await entries.deleteForClient(currentUser(res), req.params.id);
    res.status(204).end();
  });
}

export function mountTherapistEntryRoutes(router: Router, entries: EntryService): void {
  router.get('/clients/:clientId/entries', async (req, res) => {
    const list = await entries.listForTherapist(
      currentUser(res),
      req.params.clientId,
      parsePage(req.query),
    );
    res.json(list.map(toTherapistEntryDto));
  });
}
