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
import { createServices, silentLogger } from '../helpers/fakes.js';

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
    const app = express();
    app.get('/x', (_req, res) => {
      res.json(currentUser(res));
    });
    app.use(errorHandler(silentLogger));
    const res = await request(app).get('/x').expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
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

  it('works outside a business process (no bpId in context)', async () => {
    const app = express();
    app.get('/x', () => {
      throw new Error('boom');
    });
    app.use(errorHandler(silentLogger));
    const res = await request(app).get('/x').expect(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
  });
});
