import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { readPackageVersion } from '../../src/build-info.js';
import type { Pool } from '../../src/db/pool.js';
import { SystemService } from '../../src/modules/system/system-service.js';
import { TOKENS } from '../../src/tokens.js';
import { createTestApp } from '../helpers/app.js';

const build = {
  version: '1.2.3',
  commit: 'abc123',
  environment: 'staging',
  storage: 'postgres' as const,
  startedAt: new Date('2026-11-09T10:00:00Z'),
};

/** Мінімальний «пул»: відповідає на запити за списком або падає. */
function fakePool(handler: (sql: string) => unknown[] | Error): Pool {
  return {
    query: async (sql: string) => {
      const r = handler(sql);
      if (r instanceof Error) throw r;
      return { rows: r };
    },
  } as unknown as Pool;
}

describe('SystemService', () => {
  it('health without a database', async () => {
    expect(await new SystemService({ ...build, storage: 'memory' }, null).health()).toEqual({
      status: 'ok',
      database: 'not_used',
    });
  });

  it('health pings the database', async () => {
    const seen: string[] = [];
    const svc = new SystemService(
      build,
      fakePool((sql) => {
        seen.push(sql);
        return [];
      }),
    );
    expect(await svc.health()).toEqual({ status: 'ok', database: 'ok' });
    expect(seen).toEqual(['SELECT 1']);
  });

  it('health reports an unreachable database', async () => {
    const svc = new SystemService(
      build,
      fakePool(() => new Error('ECONNREFUSED')),
    );
    expect(await svc.health()).toEqual({ status: 'unavailable', database: 'unavailable' });
  });

  it('version reports build info and the newest migration', async () => {
    const svc = new SystemService(
      build,
      fakePool((sql) =>
        sql.includes('schema_migrations') ? [{ name: '002_uk_collation.sql' }] : [],
      ),
    );
    expect(await svc.version()).toEqual({
      version: '1.2.3',
      commit: 'abc123',
      environment: 'staging',
      storage: 'postgres',
      started_at: '2026-11-09T10:00:00.000Z',
      migration: '002_uk_collation.sql',
    });
  });

  it('version: migration is null when none applied, DB is down, or not used', async () => {
    expect(
      (
        await new SystemService(
          build,
          fakePool(() => []),
        ).version()
      ).migration,
    ).toBeNull();
    expect(
      (
        await new SystemService(
          build,
          fakePool(() => new Error('down')),
        ).version()
      ).migration,
    ).toBeNull();
    expect((await new SystemService(build, null).version()).migration).toBeNull();
  });
});

describe('/health over HTTP', () => {
  it('503 when the database is unreachable (balancer keeps traffic away)', async () => {
    const t = createTestApp('memory', (c) =>
      c.registerValue(
        TOKENS.systemService,
        new SystemService(
          build,
          fakePool(() => new Error('down')),
        ),
      ),
    );
    const res = await request(t.app).get('/health').expect(503);
    expect(res.body).toEqual({ status: 'unavailable', database: 'unavailable' });
  });
});

describe('readPackageVersion', () => {
  it('reads the version from package.json', () => {
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('falls back to 0.0.0 when version is missing or not a string', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pkg-'));
    const file = join(dir, 'package.json');
    writeFileSync(file, '{"name":"x"}');
    expect(readPackageVersion(pathToFileURL(file))).toBe('0.0.0');
    writeFileSync(file, '{"version":1}');
    expect(readPackageVersion(pathToFileURL(file))).toBe('0.0.0');
    writeFileSync(file, '{"version":"9.8.7"}');
    expect(readPackageVersion(pathToFileURL(file))).toBe('9.8.7');
  });
});
