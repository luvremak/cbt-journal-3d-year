import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Pool } from './pool.js';
import { createPool } from './pool.js';

export const DEFAULT_MIGRATIONS_DIR = resolve(process.cwd(), 'migrations');

/** Ключ advisory lock: одночасно мігрує лише один процес (два екземпляри під час деплою). */
const LOCK_KEY = 'cbt-journal:migrations';

/** Перший рядок файлу, що вимикає транзакцію (потрібно для CREATE INDEX CONCURRENTLY). */
export const NO_TRANSACTION_MARKER = '-- migrate:no-transaction';

export interface MigrateOptions {
  dir?: string;
  /** Скільки міграція може чекати на блокування таблиці, поки працює стара версія. */
  lockTimeout?: string;
  /** Скільки чекати, поки інший процес закінчить мігрувати (мс). */
  lockWaitMs?: number;
  /** Пауза між спробами взяти advisory lock (мс). */
  lockPollMs?: number;
  log?: (message: string) => void;
}

export class MigrationLockTimeoutError extends Error {
  constructor(waitedMs: number) {
    super(`Another process has been migrating for over ${waitedMs} ms; giving up`);
    this.name = 'MigrationLockTimeoutError';
  }
}

export class MigrationChecksumError extends Error {
  constructor(name: string) {
    super(`Migration ${name} was changed after it had been applied; add a new migration instead`);
    this.name = 'MigrationChecksumError';
  }
}

const checksum = (sql: string) => createHash('sha256').update(sql).digest('hex');

/**
 * Застосовує migrations/*.sql за алфавітом. Правила міграцій без простою —
 * standards/migrations.md. Тут — механіка:
 * - advisory lock на весь прогін. Чекаємо на нього в Node (pg_try_advisory_lock + пауза),
 *   а не всередині SQL: інакше сесія, що «висить» у pg_advisory_lock, — це відкрита
 *   транзакція, на яку чекає CREATE INDEX CONCURRENTLY іншого мігратора → deadlock;
 * - кожна міграція в окремій транзакції з lock_timeout (окрім позначених no-transaction);
 * - контрольна сума: змінену після застосування міграцію не можна тихо пропустити.
 */
export async function migrate(pool: Pool, options: MigrateOptions = {}): Promise<string[]> {
  const dir = options.dir ?? DEFAULT_MIGRATIONS_DIR;
  const lockTimeout = options.lockTimeout ?? '5s';
  const lockWaitMs = options.lockWaitMs ?? 10 * 60_000;
  const lockPollMs = options.lockPollMs ?? 250;
  const log = options.log ?? (() => {});

  const client = await pool.connect();
  try {
    const started = Date.now();
    for (;;) {
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [LOCK_KEY],
      );
      if (rows[0]?.locked) break;
      if (Date.now() - started >= lockWaitMs) throw new MigrationLockTimeoutError(lockWaitMs);
      await new Promise((resolve) => setTimeout(resolve, lockPollMs));
    }
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name       TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
      await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');

      const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
      const { rows } = await client.query<{ name: string; checksum: string | null }>(
        'SELECT name, checksum FROM schema_migrations',
      );
      const applied = new Map(rows.map((r) => [r.name, r.checksum]));
      const newlyApplied: string[] = [];

      for (const file of files) {
        const sql = await readFile(join(dir, file), 'utf8');
        const sum = checksum(sql);

        if (applied.has(file)) {
          const stored = applied.get(file);
          if (stored === null) {
            // Міграції, застосовані до появи контрольних сум.
            await client.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [
              file,
              sum,
            ]);
          } else if (stored !== sum) {
            throw new MigrationChecksumError(file);
          }
          continue;
        }

        const transactional = !sql.startsWith(NO_TRANSACTION_MARKER);
        if (transactional) {
          await client.query('BEGIN');
          await client.query(`SET LOCAL lock_timeout = '${lockTimeout.replace(/'/g, '')}'`);
        }
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
            file,
            sum,
          ]);
          if (transactional) await client.query('COMMIT');
        } catch (error) {
          if (transactional) await client.query('ROLLBACK');
          throw error;
        }
        newlyApplied.push(file);
        log(`applied ${file}`);
      }
      return newlyApplied;
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = createPool(url);
  migrate(pool, { log: (m) => process.stdout.write(`${m}\n`) })
    .then((applied) => process.stdout.write(`migrations done (${applied.length} new)\n`))
    .finally(() => pool.end());
}
