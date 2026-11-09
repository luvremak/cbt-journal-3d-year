import express, { Router, type Express } from 'express';
import type { Container } from '../lib/di/container.js';
import {
  mountClientEntryRoutes,
  mountTherapistEntryRoutes,
} from '../modules/entries/entry-routes.js';
import { mountTherapistNoteRoutes } from '../modules/notes/note-routes.js';
import { mountClientUserRoutes, mountTherapistUserRoutes } from '../modules/users/user-routes.js';
import { TOKENS } from '../tokens.js';
import { authenticate, requireRole } from './middleware/auth.js';
import { businessProcess } from './middleware/business-process.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';

export function createApp(container: Container): Express {
  const logger = container.resolve(TOKENS.logger);
  const users = container.resolve(TOKENS.userService);
  const entries = container.resolve(TOKENS.entryService);
  const notes = container.resolve(TOKENS.noteService);
  const system = container.resolve(TOKENS.systemService);

  const app = express();
  app.disable('x-powered-by');
  app.use(businessProcess(logger));
  // Явний ліміт тіла (збігається з типовим у Express): 4 поля × 5000 символів уміщуються.
  // Stryker disable next-line ObjectLiteral: еквівалентний мутант — типовий ліміт теж 100kb.
  app.use(express.json({ limit: '100kb' }));

  // Службові ендпоінти — без X-User-Id.
  app.get('/health', async (_req, res) => {
    const health = await system.health();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });
  app.get('/version', async (_req, res) => {
    res.json(await system.version());
  });

  const client = Router();
  client.use(authenticate(users), requireRole('client'));
  mountClientEntryRoutes(client, entries);
  mountClientUserRoutes(client, users);
  app.use('/client', client);

  const therapist = Router();
  therapist.use(authenticate(users), requireRole('therapist'));
  mountTherapistUserRoutes(therapist, users);
  mountTherapistEntryRoutes(therapist, entries);
  mountTherapistNoteRoutes(therapist, notes);
  app.use('/therapist', therapist);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
