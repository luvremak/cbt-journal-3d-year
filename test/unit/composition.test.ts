/** Composition root: STORAGE лише підміняє реалізації репозиторіїв у DI. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../../src/config.js';
import type { Pool } from '../../src/db/pool.js';
import { buildContainer } from '../../src/container.js';
import { parseBody } from '../../src/http/validate.js';
import { ValidationError } from '../../src/lib/errors.js';
import { InMemoryEntryRepository } from '../../src/modules/entries/in-memory-entry-repository.js';
import { PgEntryRepository } from '../../src/modules/entries/pg-entry-repository.js';
import { EntryService } from '../../src/modules/entries/entry-service.js';
import { InMemoryNoteRepository } from '../../src/modules/notes/in-memory-note-repository.js';
import { NoteService } from '../../src/modules/notes/note-service.js';
import { PgNoteRepository } from '../../src/modules/notes/pg-note-repository.js';
import { InMemoryUserRepository } from '../../src/modules/users/in-memory-user-repository.js';
import { CachingUserRepository } from '../../src/modules/users/caching-user-repository.js';
import { PgUserRepository } from '../../src/modules/users/pg-user-repository.js';
import { UserService } from '../../src/modules/users/user-service.js';
import { SEED_IDS } from '../../src/seed-data.js';
import { TOKENS } from '../../src/tokens.js';

describe('buildContainer', () => {
  it('memory: in-memory repositories, no pool, services wired', async () => {
    const config = loadConfig({ STORAGE: 'memory', LOG_LEVEL: 'warn' });
    const c = buildContainer(config);
    expect(c.resolve(TOKENS.config)).toBe(config);
    expect(c.resolve(TOKENS.logger).level).toBe('warn');
    expect(c.resolve(TOKENS.userRepository)).toBeInstanceOf(InMemoryUserRepository);
    expect(c.resolve(TOKENS.entryRepository)).toBeInstanceOf(InMemoryEntryRepository);
    expect(c.resolve(TOKENS.noteRepository)).toBeInstanceOf(InMemoryNoteRepository);
    expect(c.has(TOKENS.pool)).toBe(false);
    expect(c.resolve(TOKENS.userService)).toBeInstanceOf(UserService);
    expect(c.resolve(TOKENS.entryService)).toBeInstanceOf(EntryService);
    expect(c.resolve(TOKENS.noteService)).toBeInstanceOf(NoteService);
    expect(await c.resolve(TOKENS.systemService).health()).toEqual({
      status: 'ok',
      database: 'not_used',
    });
    expect(await c.resolve(TOKENS.systemService).version()).toMatchObject({
      storage: 'memory',
      environment: 'local',
      commit: 'unknown',
      migration: null,
    });
    // Статичні дані вже на місці.
    expect(await c.resolve(TOKENS.userRepository).findById(SEED_IDS.clientIryna)).not.toBeNull();
  });

  it('memory: notes see deletions made through the entry repository (shared storage)', async () => {
    const c = buildContainer(loadConfig({ STORAGE: 'memory' }));
    await c.resolve(TOKENS.entryRepository).softDelete(SEED_IDS.entryIryna2);
    const note = await c.resolve(TOKENS.noteRepository).createIfEntryActive({
      entryId: SEED_IDS.entryIryna2,
      therapistId: SEED_IDS.therapistOlena,
      text: 'x',
    });
    expect(note).toBeNull();
  });

  it('postgres: user cache gets TTL and size from config', async () => {
    let queries = 0;
    let now = 0;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const c = buildContainer(
        loadConfig({
          STORAGE: 'postgres',
          DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
          USER_CACHE_TTL_MS: '1000',
          USER_CACHE_MAX: '1',
        }),
      );
      // Підміняємо пул до першого resolve: рахуємо звернення до «БД».
      c.registerValue(TOKENS.pool, {
        query: async (_sql: string, params: string[]) => {
          queries++;
          return {
            rows: [{ id: params[0], role: 'client', name: 'x', contacts: 'x', therapist_id: 't' }],
          };
        },
      } as unknown as Pool);
      const users = c.resolve(TOKENS.userRepository);
      await users.findById(SEED_IDS.clientIryna);
      await users.findById(SEED_IDS.clientIryna);
      expect(queries).toBe(1); // кеш працює
      now = 1000;
      await users.findById(SEED_IDS.clientIryna);
      expect(queries).toBe(2); // TTL = 1000 мс
      await users.findById(SEED_IDS.clientMaksym); // max = 1 → Ірину витіснено
      await users.findById(SEED_IDS.clientIryna);
      expect(queries).toBe(4);
    } finally {
      Date.now = realNow;
    }
  });

  it('postgres with USER_CACHE_TTL_MS=0: plain Pg user repository', async () => {
    const c = buildContainer(
      loadConfig({
        STORAGE: 'postgres',
        DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x',
        USER_CACHE_TTL_MS: '0',
      }),
    );
    expect(c.resolve(TOKENS.userRepository)).toBeInstanceOf(PgUserRepository);
    await c.dispose();
  });

  it('postgres without DATABASE_URL (config built by hand) fails fast', () => {
    expect(() =>
      buildContainer({
        PORT: 1,
        LOG_LEVEL: 'silent',
        STORAGE: 'postgres',
        APP_ENV: 'test',
        GIT_COMMIT: 'x',
        USER_CACHE_TTL_MS: 0,
        USER_CACHE_MAX: 1,
      }),
    ).toThrow('DATABASE_URL is required when STORAGE=postgres');
  });

  it('postgres: Pg repositories on one pool from DATABASE_URL (no connection is opened)', async () => {
    const url = 'postgres://u:p@127.0.0.1:1/never';
    const c = buildContainer(loadConfig({ STORAGE: 'postgres', DATABASE_URL: url }));
    const pool = c.resolve(TOKENS.pool);
    let ended = false;
    const originalEnd = pool.end.bind(pool);
    pool.end = async () => {
      ended = true;
      return originalEnd();
    };
    try {
      expect(pool.options.connectionString).toBe(url);
      // За замовчуванням Pg-репозиторій обгорнуто кешем (perf).
      expect(c.resolve(TOKENS.userRepository)).toBeInstanceOf(CachingUserRepository);
      expect(c.resolve(TOKENS.entryRepository)).toBeInstanceOf(PgEntryRepository);
      expect(c.resolve(TOKENS.noteRepository)).toBeInstanceOf(PgNoteRepository);
      expect(pool.totalCount).toBe(0);
      expect((await c.resolve(TOKENS.systemService).version()).storage).toBe('postgres');
    } finally {
      await c.dispose();
    }
    expect(ended).toBe(true); // пул закриває container.dispose()
  });
});

describe('parseBody', () => {
  const schema = z.object({ a: z.object({ b: z.string() }) });

  it('returns parsed data', () => {
    expect(parseBody(schema, { a: { b: 'x' } })).toEqual({ a: { b: 'x' } });
  });

  it('missing body is validated as {} → 422 with dotted field paths', () => {
    try {
      parseBody(schema, { a: {} });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toBe('Request body is invalid');
      expect((error as ValidationError).details).toEqual([
        { field: 'a.b', message: expect.any(String) },
      ]);
    }
    expect(() => parseBody(schema, undefined)).toThrow(ValidationError);
  });
});
