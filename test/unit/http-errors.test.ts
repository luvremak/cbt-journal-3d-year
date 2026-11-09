/**
 * Глобальний обробник помилок і DI: підміняємо репозиторій через контейнер,
 * щоб змусити сервер впасти, і перевіряємо, що назовні не виходять деталі.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import express from 'express';
import { authenticate, currentUser } from '../../src/http/middleware/auth.js';
import { errorHandler } from '../../src/http/middleware/error-handler.js';
import type { EntryRepository } from '../../src/modules/entries/entry.js';
import { SEED_IDS } from '../../src/seed-data.js';
import { TOKENS } from '../../src/tokens.js';
import { createTestApp } from '../helpers/app.js';
import { captureLogger, createServices, silentLogger } from '../helpers/fakes.js';

const failing: EntryRepository = {
  create: () => Promise.reject(new Error('secret db detail: password=123')),
  findById: () => Promise.reject(new Error('secret db detail')),
  findByClient: () => Promise.reject(new Error('secret db detail')),
  softDelete: () => Promise.reject(new Error('secret db detail')),
};

describe('global error handler', () => {
  it('unexpected error → 500 without internals, logged with bpId', async () => {
    const t = createTestApp('memory', (c) => c.registerValue(TOKENS.entryRepository, failing));
    const res = await request(t.app)
      .get('/client/entries')
      .set('X-User-Id', SEED_IDS.clientIryna)
      .expect(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      bp_id: res.headers['x-business-process-id'],
    });
    expect(JSON.stringify(res.body)).not.toContain('secret');
    const errorLog = t.logs.find((l) => l.msg === 'unhandled error');
    expect(errorLog).toMatchObject({ level: 50, bpId: res.headers['x-business-process-id'] });
    // Деталі лишаються в логах для розслідування.
    expect(errorLog?.err).toMatchObject({ message: 'secret db detail' });
  });

  it('domain errors are logged at info as "request rejected" with code and reason', async () => {
    const t = createTestApp('memory');
    await request(t.app).get('/client/entries').expect(401);
    expect(t.logs.find((l) => l.msg === 'request rejected')).toMatchObject({
      level: 30,
      status: 401,
      code: 'UNAUTHORIZED',
      reason: 'X-User-Id header is required',
    });
  });

  it('currentUser() without authenticate is a programming error → 500', async () => {
    const { logger, logs } = captureLogger();
    const app = express();
    app.get('/x', (_req, res) => {
      res.json(currentUser(res));
    });
    app.use(errorHandler(logger));
    const res = await request(app).get('/x').expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(logs[0]?.err).toMatchObject({
      message: 'currentUser() called before authenticate()',
    });
  });

  it('authenticate stores the user for handlers', async () => {
    const { users } = createServices();
    const app = express();
    app.get('/me', authenticate(users), (_req, res) => {
      res.json({ id: currentUser(res).id });
    });
    app.use(errorHandler(silentLogger));
    const res = await request(app).get('/me').set('X-User-Id', SEED_IDS.clientMaksym).expect(200);
    expect(res.body).toEqual({ id: SEED_IDS.clientMaksym });
  });

  it('outside a business process falls back to the bp response header', async () => {
    const app = express();
    app.get('/x', (_req, res) => {
      res.setHeader('X-Business-Process-Id', 'from-header');
      throw new Error('boom');
    });
    app.get('/y', () => {
      throw new Error('boom');
    });
    app.use(errorHandler(silentLogger));
    const x = await request(app).get('/x').expect(500);
    expect(x.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      bp_id: 'from-header',
    });
    const y = await request(app).get('/y').expect(500);
    expect(y.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });
});
