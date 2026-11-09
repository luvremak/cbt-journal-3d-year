import { createPool, type Pool } from '../../src/db/pool.js';
import { seed } from '../../src/db/seed.js';

/** Тести з БД запускаються лише коли задано TEST_DATABASE_URL (див. README). */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasDb = Boolean(TEST_DATABASE_URL);

export function createTestPool(): Pool {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  return createPool(TEST_DATABASE_URL);
}

/** Повертає БД до стану «лише seed». */
export async function resetDb(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE therapist_notes, entries, users CASCADE');
  await seed(pool);
}
