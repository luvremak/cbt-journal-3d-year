import pg from 'pg';
import { migrate } from '../../src/db/migrate.js';
import { createPool } from '../../src/db/pool.js';

/**
 * Перед усіма тестами: створює тестову БД (якщо її немає), очищає схему
 * і застосовує міграції з нуля. БД обов'язкова; режим без неї — vitest.nodb.config.ts.
 */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is empty; use `npm run test:nodb` to skip DB tests');

  const dbName = new URL(url).pathname.slice(1);
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `PostgreSQL is not reachable at ${adminUrl.host} — start it with \`make db-up\` ` +
        'or run `npm run test:nodb` to skip DB tests',
      { cause: error },
    );
  }
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      dbName,
    ]);
    if (rowCount === 0) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  } finally {
    await admin.end();
  }

  const pool = createPool(url);
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
