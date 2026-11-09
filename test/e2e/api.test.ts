/**
 * E2E: повний HTTP-стек (middleware → routes → services → repositories) проти сценаріїв spec.
 * Режим memory — завжди; postgres — коли задано TEST_DATABASE_URL.
 */
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEED_IDS } from '../../src/seed-data.js';
import { TOKENS } from '../../src/tokens.js';
import { createTestApp, type Storage, type TestApp } from '../helpers/app.js';
import { hasDb, resetDb } from '../helpers/db.js';

const { therapistOlena: T1, therapistAndrii: T2, clientIryna: C1, clientMaksym: C2 } = SEED_IDS;
const { clientSofiia: C3, entryIryna1: E1, entryIryna2: E2, entrySofiia1: E3 } = SEED_IDS;
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

const storages: Storage[] = hasDb ? ['memory', 'postgres'] : ['memory'];

const entryBody = {
  situation: 'Сварка',
  thought: 'Я винен',
  emotion: 'провина',
  emotion_intensity: 60,
};

describe.each(storages)('API e2e [%s]', (storage) => {
  let t: TestApp;

  beforeAll(() => {
    t = createTestApp(storage);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    if (storage === 'postgres') {
      await resetDb(t.container.resolve(TOKENS.pool));
    } else {
      await t.close();
      t = createTestApp('memory'); // свіжі статичні дані для кожного тесту
    }
  });

  const as = (user: string | null) => {
    const agent = {
      get: (path: string) => withUser(request(t.app).get(path)),
      post: (path: string, body?: unknown) => {
        const r = withUser(request(t.app).post(path));
        return body === undefined ? r : r.send(body as object);
      },
      delete: (path: string) => withUser(request(t.app).delete(path)),
    };
    function withUser(r: request.Test) {
      return user === null ? r : r.set('X-User-Id', user);
    }
    return agent;
  };

  const createEntry = async (client = C2, body: object = entryBody) => {
    const res = await as(client).post('/client/entries', body).expect(201);
    return res.body as { id: string };
  };

  describe('health and routing', () => {
    it('GET /health → 200 without auth, no x-powered-by, checks the database', async () => {
      const res = await request(t.app).get('/health').expect(200);
      expect(res.body).toEqual({
        status: 'ok',
        database: storage === 'postgres' ? 'ok' : 'not_used',
      });
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('GET /version → build info and the last applied migration, without auth', async () => {
      const res = await request(t.app).get('/version').expect(200);
      expect(res.body).toEqual({
        version: expect.stringMatching(/^\d+\.\d+\.\d+/),
        commit: 'unknown',
        environment: 'local',
        storage,
        started_at: expect.any(String),
        migration: storage === 'postgres' ? '005_drop_entries_client_created_idx.sql' : null,
      });
    });

    it('unknown route → 404 in the common error format', async () => {
      const res = await request(t.app).get('/nope').expect(404);
      expect(res.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'Route GET /nope not found' },
        bp_id: expect.any(String),
      });
    });
  });

  describe('identification (spec §7)', () => {
    it.each([
      ['missing X-User-Id', null],
      ['non-UUID X-User-Id', 'abc'],
      ['unknown user', UNKNOWN],
    ])('%s → 401', async (_n, user) => {
      const res = await as(user).get('/client/entries').expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('client on a therapist endpoint → 403', async () => {
      const res = await as(C1).get('/therapist/clients').expect(403);
      expect(res.body.error).toEqual({
        code: 'FORBIDDEN',
        message: 'This endpoint is for role "therapist"',
      });
    });

    it('therapist on a client endpoint → 403', async () => {
      await as(T1).get('/client/entries').expect(403);
      await as(T1).post('/client/entries', entryBody).expect(403);
    });
  });

  describe('client', () => {
    it('lists own active entries newest first (spec §4)', async () => {
      const res = await as(C1).get('/client/entries').expect(200);
      expect(res.body.map((e: { id: string }) => e.id)).toEqual([E2, E1]);
      expect(res.body[0]).toEqual({
        id: E2,
        situation: 'Подруга скасувала зустріч',
        thought: 'Я їй нецікава',
        emotion: 'смуток',
        emotion_intensity: 55,
        rational_response: null,
        created_at: '2026-11-03T18:40:00.000Z',
      });
    });

    it('sees name and contacts of own therapist', async () => {
      const res = await as(C1).get('/client/therapist').expect(200);
      expect(res.body).toEqual({
        id: T1,
        name: 'Олена Коваль',
        contacts: 'olena.koval@example.com, +380 50 000 0001',
      });
    });

    it('creates an entry: trims text, blank rational_response → null', async () => {
      const res = await as(C2)
        .post('/client/entries', {
          ...entryBody,
          situation: '  Сварка  ',
          rational_response: '   ',
        })
        .expect(201);
      expect(res.body).toMatchObject({ situation: 'Сварка', rational_response: null });
      const list = await as(C2).get('/client/entries').expect(200);
      expect(list.body.map((e: { id: string }) => e.id)).toEqual([res.body.id]);
    });

    it('intensity 0 and 100 are valid boundaries', async () => {
      await as(C2)
        .post('/client/entries', { ...entryBody, emotion_intensity: 0 })
        .expect(201);
      await as(C2)
        .post('/client/entries', { ...entryBody, emotion_intensity: 100 })
        .expect(201);
    });

    it.each([
      ['empty situation', { ...entryBody, situation: '   ' }],
      ['missing thought', { ...entryBody, thought: undefined }],
      ['intensity as string', { ...entryBody, emotion_intensity: '10' }],
      ['intensity fraction', { ...entryBody, emotion_intensity: 10.5 }],
      ['intensity 101', { ...entryBody, emotion_intensity: 101 }],
      ['intensity -1', { ...entryBody, emotion_intensity: -1 }],
      ['emotion 101 chars', { ...entryBody, emotion: 'a'.repeat(101) }],
      ['situation 5001 chars', { ...entryBody, situation: 'a'.repeat(5001) }],
    ])('%s → 422 with field details', async (_n, body) => {
      const res = await as(C2).post('/client/entries', body).expect(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Request body is invalid');
      expect(res.body.error.details.length).toBeGreaterThan(0);
      expect(res.body.error.details[0]).toEqual({
        field: expect.any(String),
        message: expect.any(String),
      });
    });

    it('no body → 422', async () => {
      await as(C2).post('/client/entries').expect(422);
    });

    it('malformed JSON → 400', async () => {
      const res = await request(t.app)
        .post('/client/entries')
        .set('X-User-Id', C2)
        .set('Content-Type', 'application/json')
        .send('{"situation":')
        .expect(400);
      expect(res.body.error).toEqual({ code: 'BAD_REQUEST', message: 'Malformed JSON body' });
      expect(res.body.bp_id).toBe(res.headers['x-business-process-id']);
    });

    it('body over 100kb → 413', async () => {
      const res = await as(C2)
        .post('/client/entries', { ...entryBody, situation: 'a'.repeat(150_000) })
        .expect(413);
      expect(res.body.error).toEqual({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large',
      });
    });

    it('gets own entry by id', async () => {
      const res = await as(C1).get(`/client/entries/${E1}`).expect(200);
      expect(res.body.id).toBe(E1);
    });

    it.each([
      ['foreign entry', E1],
      ['unknown id', UNKNOWN],
      ['non-UUID id', 'not-a-uuid'],
    ])('GET %s → 404', async (_n, id) => {
      await as(C2).get(`/client/entries/${id}`).expect(404);
    });

    it('cannot delete a foreign entry → 404 (spec §7)', async () => {
      await as(C2).delete(`/client/entries/${E1}`).expect(404);
      await as(C1).get(`/client/entries/${E1}`).expect(200);
    });

    it('soft delete: 204, then hidden; repeat delete → 404 (spec §4, §7)', async () => {
      await as(C1).delete(`/client/entries/${E1}`).expect(204);
      await as(C1).delete(`/client/entries/${E1}`).expect(404);
      await as(C1).get(`/client/entries/${E1}`).expect(404);
      const list = await as(C1).get('/client/entries').expect(200);
      expect(list.body.map((e: { id: string }) => e.id)).toEqual([E2]);
    });
  });

  describe('therapist', () => {
    it('lists only own clients with name and contacts (spec §2)', async () => {
      const res = await as(T1).get('/therapist/clients').expect(200);
      expect(res.body).toEqual([
        { id: C1, name: 'Ірина', contacts: 'iryna@example.com' },
        { id: C2, name: 'Максим', contacts: 'maksym@example.com' },
      ]);
    });

    it('reads own client entries', async () => {
      const res = await as(T1).get(`/therapist/clients/${C1}/entries`).expect(200);
      expect(res.body.map((e: { id: string; deleted: boolean }) => [e.id, e.deleted])).toEqual([
        [E2, false],
        [E1, false],
      ]);
      expect(res.body[0].situation).toBe('Подруга скасувала зустріч');
    });

    it('deleted entry shows only id, deleted, created_at, deleted_at (spec §4)', async () => {
      await as(C1).delete(`/client/entries/${E1}`).expect(204);
      const res = await as(T1).get(`/therapist/clients/${C1}/entries`).expect(200);
      const deleted = res.body.find((e: { id: string }) => e.id === E1);
      expect(Object.keys(deleted).sort()).toEqual(['created_at', 'deleted', 'deleted_at', 'id']);
      expect(deleted.deleted).toBe(true);
    });

    it.each([
      ['foreign client entries', 'get', `/therapist/clients/${C3}/entries`],
      ['a therapist as client', 'get', `/therapist/clients/${T2}/entries`],
      ['notes of a foreign entry', 'get', `/therapist/entries/${E3}/notes`],
      ['note on a foreign entry', 'post', `/therapist/entries/${E3}/notes`],
      ['notes of an unknown entry', 'get', `/therapist/entries/${UNKNOWN}/notes`],
      ['notes with non-UUID id', 'get', '/therapist/entries/abc/notes'],
    ] as const)('%s → 404 (spec §7)', async (_n, method, path) => {
      const agent = as(T1);
      const res = method === 'get' ? await agent.get(path) : await agent.post(path, { text: 'x' });
      expect(res.status).toBe(404);
    });

    it('creates and lists notes, newest first', async () => {
      const first = await as(T1)
        .post(`/therapist/entries/${E1}/notes`, { text: ' Нова ' })
        .expect(201);
      expect(first.body).toEqual({
        id: expect.any(String),
        entry_id: E1,
        text: 'Нова',
        created_at: expect.any(String),
      });
      const list = await as(T1).get(`/therapist/entries/${E1}/notes`).expect(200);
      expect(list.body.map((n: { id: string }) => n.id)).toEqual([
        first.body.id,
        SEED_IDS.noteIryna1,
      ]);
    });

    it('empty note → 422', async () => {
      await as(T1).post(`/therapist/entries/${E1}/notes`, { text: '  ' }).expect(422);
    });

    it('notes survive entry deletion; new note on deleted entry → 409 (spec §4, §7)', async () => {
      const { id } = await createEntry(C2);
      await as(T1).post(`/therapist/entries/${id}/notes`, { text: 'Перевірити' }).expect(201);
      await as(C2).delete(`/client/entries/${id}`).expect(204);
      const notes = await as(T1).get(`/therapist/entries/${id}/notes`).expect(200);
      expect(notes.body.map((n: { text: string }) => n.text)).toEqual(['Перевірити']);
      const res = await as(T1).post(`/therapist/entries/${id}/notes`, { text: 'ще' }).expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('client cannot read therapist notes (no such endpoint for clients)', async () => {
      await as(C1).get(`/therapist/entries/${E1}/notes`).expect(403);
    });
  });

  describe('pagination (spec §4)', () => {
    it('limit/offset walk the list without gaps or duplicates', async () => {
      const p1 = await as(C1).get('/client/entries?limit=1').expect(200);
      const p2 = await as(C1).get('/client/entries?limit=1&offset=1').expect(200);
      const p3 = await as(C1).get('/client/entries?limit=1&offset=2').expect(200);
      expect([...p1.body, ...p2.body].map((e: { id: string }) => e.id)).toEqual([E2, E1]);
      expect(p3.body).toEqual([]);
    });

    it('equal created_at: order by id keeps pages stable', async () => {
      if (storage === 'memory') return; // у пам'яті не можна задати однаковий час через API
      const pool = t.container.resolve(TOKENS.pool);
      await pool.query(
        `UPDATE entries SET created_at = '2026-11-05T00:00:00Z' WHERE client_id = $1`,
        [C1],
      );
      const all = await as(C1).get('/client/entries').expect(200);
      expect(all.body.map((e: { id: string }) => e.id)).toEqual([E2, E1].sort().reverse());
      const p1 = await as(C1).get('/client/entries?limit=1').expect(200);
      const p2 = await as(C1).get('/client/entries?limit=1&offset=1').expect(200);
      expect([p1.body[0].id, p2.body[0].id]).toEqual(all.body.map((e: { id: string }) => e.id));
    });

    it.each(['limit=0', 'limit=101', 'limit=5.5', 'limit=abc', 'offset=-1'])(
      '?%s → 422',
      async (q) => {
        await as(C1).get(`/client/entries?${q}`).expect(422);
      },
    );

    it('limit=100 is allowed', async () => {
      await as(C1).get('/client/entries?limit=100').expect(200);
    });

    it('applies to therapist lists too', async () => {
      const clients = await as(T1).get('/therapist/clients?limit=1&offset=1').expect(200);
      expect(clients.body.map((c: { name: string }) => c.name)).toEqual(['Максим']);
      await as(T1).get(`/therapist/clients/${C1}/entries?limit=0`).expect(422);
      const entries = await as(T1).get(`/therapist/clients/${C1}/entries?limit=1`).expect(200);
      expect(entries.body).toHaveLength(1);
      await as(T1).get(`/therapist/entries/${E1}/notes?offset=-1`).expect(422);
      const notes = await as(T1).get(`/therapist/entries/${E1}/notes?offset=1`).expect(200);
      expect(notes.body).toEqual([]);
    });
  });

  describe('business-process id', () => {
    it('generated per request and returned in header and error body', async () => {
      const a = await as(null).get('/client/entries').expect(401);
      const b = await as(null).get('/client/entries').expect(401);
      const bpA = a.headers['x-business-process-id'];
      expect(bpA).toMatch(/^[0-9a-f-]{36}$/);
      expect(a.body.bp_id).toBe(bpA);
      expect(b.headers['x-business-process-id']).not.toBe(bpA);
    });

    it('incoming valid id is reused; invalid one is replaced', async () => {
      const id = '12345678-1234-4234-8234-123456789012';
      const ok = await request(t.app).get('/health').set('X-Business-Process-Id', id);
      expect(ok.headers['x-business-process-id']).toBe(id);
      const bad = await request(t.app).get('/health').set('X-Business-Process-Id', 'nope');
      expect(bad.headers['x-business-process-id']).not.toBe('nope');
      expect(bad.headers['x-business-process-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('every log line of the request carries the same bpId and the user', async () => {
      const res = await as(C2).post('/client/entries', entryBody).expect(201);
      const bpId = res.headers['x-business-process-id'];
      const lines = t.logs.filter((l) => l.bpId === bpId);
      const messages = lines.map((l) => l.msg);
      expect(messages).toEqual(['request started', 'entry created', 'request finished']);
      expect(lines.every((l) => l.service === 'cbt-journal')).toBe(true);
      expect(lines[0]).toMatchObject({ method: 'POST', path: '/client/entries' });
      expect(lines.find((l) => l.msg === 'entry created')).toMatchObject({
        userId: C2,
        entryId: res.body.id,
      });
      expect(lines.at(-1)).toMatchObject({
        method: 'POST',
        path: '/client/entries',
        status: 201,
        durationMs: expect.any(Number),
      });
      const durationMs = lines.at(-1)?.durationMs as number;
      expect(durationMs).toBeGreaterThan(0);
      expect(durationMs).toBeLessThan(10_000);
    });
  });
});
