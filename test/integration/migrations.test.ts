/**
 * Раннер міграцій на справжньому PostgreSQL, кожен тест — в окремій схемі,
 * щоб не чіпати основну тестову БД.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MIGRATIONS_DIR,
  migrate,
  MigrationChecksumError,
  MigrationLockTimeoutError,
  NO_TRANSACTION_MARKER,
} from '../../src/db/migrate.js';
import { createPool, type Pool } from '../../src/db/pool.js';
import { hasDb, TEST_DATABASE_URL } from '../helpers/db.js';

const pools: Pool[] = [];
const schemas: string[] = [];

/** Пул, у якого всі таблиці створюються в окремій схемі. */
async function isolatedPool(): Promise<Pool> {
  const schema = `mig_${Math.random().toString(36).slice(2, 10)}`;
  const admin = createPool(TEST_DATABASE_URL ?? '');
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const url = new URL(TEST_DATABASE_URL ?? '');
  url.searchParams.set('options', `-c search_path=${schema}`);
  const pool = createPool(url.toString());
  pools.push(pool);
  schemas.push(schema);
  return pool;
}

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

const tables = async (pool: Pool) =>
  (
    await pool.query<{ t: string }>(
      `SELECT table_name AS t FROM information_schema.tables
       WHERE table_schema = current_schema() ORDER BY 1`,
    )
  ).rows.map((r) => r.t);

describe.skipIf(!hasDb)('migration runner (zero-downtime mechanics)', () => {
  afterEach(async () => {
    for (const p of pools.splice(0)) await p.end();
    const admin = createPool(TEST_DATABASE_URL ?? '');
    for (const s of schemas.splice(0)) await admin.query(`DROP SCHEMA ${s} CASCADE`);
    await admin.end();
  });

  it('applies the real migrations once; a second run applies nothing', async () => {
    const pool = await isolatedPool();
    const logs: string[] = [];
    const all = [
      '001_init.sql',
      '002_uk_collation.sql',
      '003_entries_active_page_idx.sql',
      '004_entries_page_idx.sql',
      '005_drop_entries_client_created_idx.sql',
    ];
    expect(await migrate(pool, { log: (m) => logs.push(m) })).toEqual(all);
    expect(logs).toEqual(all.map((f) => `applied ${f}`));
    expect(await migrate(pool)).toEqual([]);
    expect(await tables(pool)).toEqual([
      'entries',
      'schema_migrations',
      'therapist_notes',
      'users',
    ]);
    expect(DEFAULT_MIGRATIONS_DIR.endsWith('migrations')).toBe(true);
  });

  it('two instances starting at once: advisory lock serialises them, no errors', async () => {
    const pool = await isolatedPool();
    const [a, b] = await Promise.all([migrate(pool), migrate(pool)]);
    expect([...a, ...b].sort()).toHaveLength(5);
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM schema_migrations');
    expect(Number(rows[0]?.n)).toBe(5);
  });

  it('a failing migration is rolled back completely and stops the run', async () => {
    const pool = await isolatedPool();
    const dir = dirWith({
      '001_ok.sql': 'CREATE TABLE a (id int);',
      '002_bad.sql': 'CREATE TABLE b (id int); SELECT no_such_function();',
      '003_never.sql': 'CREATE TABLE c (id int);',
    });
    await expect(migrate(pool, { dir })).rejects.toThrow(/no_such_function/);
    expect(await tables(pool)).toEqual(['a', 'schema_migrations']);
    const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
    expect(rows.map((r) => r.name)).toEqual(['001_ok.sql']);
  });

  it('refuses an already applied migration whose file was changed', async () => {
    const pool = await isolatedPool();
    const dir = dirWith({ '001_a.sql': 'CREATE TABLE a (id int);' });
    await migrate(pool, { dir });
    writeFileSync(join(dir, '001_a.sql'), 'CREATE TABLE a (id bigint);');
    await expect(migrate(pool, { dir })).rejects.toThrow(MigrationChecksumError);
    await expect(migrate(pool, { dir })).rejects.toThrow(
      'Migration 001_a.sql was changed after it had been applied; add a new migration instead',
    );
  });

  it('fills checksums for migrations applied before checksums existed', async () => {
    const pool = await isolatedPool();
    const dir = dirWith({ '001_a.sql': 'CREATE TABLE a (id int);' });
    await pool.query(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query('CREATE TABLE a (id int)');
    await pool.query(`INSERT INTO schema_migrations (name) VALUES ('001_a.sql')`);
    expect(await migrate(pool, { dir })).toEqual([]);
    const { rows } = await pool.query<{ checksum: string }>(
      'SELECT checksum FROM schema_migrations',
    );
    expect(rows[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(join(dir, '001_a.sql'), 'changed');
    await expect(migrate(pool, { dir })).rejects.toThrow(MigrationChecksumError);
  });

  it('lock_timeout: a migration gives up instead of blocking live traffic', async () => {
    const pool = await isolatedPool();
    await pool.query('CREATE TABLE busy (id int)');
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE busy IN ACCESS SHARE MODE'); // «стара версія» читає таблицю
      const dir = dirWith({ '001_alter.sql': 'ALTER TABLE busy ADD COLUMN x int;' });
      const started = Date.now();
      await expect(migrate(pool, { dir, lockTimeout: '200ms' })).rejects.toThrow(/lock timeout/);
      expect(Date.now() - started).toBeLessThan(3000);
      await holder.query('ROLLBACK');
      // Після звільнення таблиці повторний запуск проходить.
      expect(await migrate(pool, { dir, lockTimeout: '200ms' })).toEqual(['001_alter.sql']);
    } finally {
      holder.release();
    }
  });

  it('no-transaction marker allows CREATE INDEX CONCURRENTLY', async () => {
    const pool = await isolatedPool();
    const dir = dirWith({
      '001_t.sql': 'CREATE TABLE t (id int);',
      '002_idx.sql': `${NO_TRANSACTION_MARKER}\nCREATE INDEX CONCURRENTLY t_id_idx ON t (id);`,
    });
    expect(await migrate(pool, { dir })).toEqual(['001_t.sql', '002_idx.sql']);
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_indexes WHERE indexname = 't_id_idx'`,
    );
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('a failing no-transaction migration is not recorded', async () => {
    const pool = await isolatedPool();
    const dir = dirWith({ '001_bad.sql': `${NO_TRANSACTION_MARKER}\nSELECT no_such_function();` });
    await expect(migrate(pool, { dir })).rejects.toThrow(/no_such_function/);
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM schema_migrations');
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('two instances with CREATE INDEX CONCURRENTLY do not deadlock', async () => {
    const pool = await isolatedPool();
    const dir = dirWith({
      '001_t.sql': 'CREATE TABLE t (id int);',
      '002_idx.sql': `${NO_TRANSACTION_MARKER}\nCREATE INDEX CONCURRENTLY IF NOT EXISTS t_idx ON t (id);`,
      '003_idx2.sql': `${NO_TRANSACTION_MARKER}\nCREATE INDEX CONCURRENTLY IF NOT EXISTS t_idx2 ON t (id);`,
    });
    const [a, b] = await Promise.all([
      migrate(pool, { dir, lockPollMs: 20 }),
      migrate(pool, { dir, lockPollMs: 20 }),
    ]);
    expect([...a, ...b].sort()).toEqual(['001_t.sql', '002_idx.sql', '003_idx2.sql']);
  });

  it('gives up waiting for another migrator after lockWaitMs', async () => {
    const pool = await isolatedPool();
    const holder = await pool.connect();
    try {
      await holder.query(`SELECT pg_advisory_lock(hashtext('cbt-journal:migrations'))`);
      const started = Date.now();
      await expect(
        migrate(pool, { dir: dirWith({}), lockWaitMs: 300, lockPollMs: 50 }),
      ).rejects.toThrow(new MigrationLockTimeoutError(300));
      expect(Date.now() - started).toBeGreaterThanOrEqual(300);
      expect(new MigrationLockTimeoutError(1).name).toBe('MigrationLockTimeoutError');
    } finally {
      await holder.query(`SELECT pg_advisory_unlock(hashtext('cbt-journal:migrations'))`);
      holder.release();
    }
  });

  it('releases the advisory lock even when a migration fails', async () => {
    const pool = await isolatedPool();
    await expect(
      migrate(pool, { dir: dirWith({ '001_bad.sql': 'SELECT no_such_function();' }) }),
    ).rejects.toThrow();
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_locks WHERE locktype = 'advisory'`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
