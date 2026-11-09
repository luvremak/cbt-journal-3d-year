/**
 * Готує базу для навантажувального тесту: міграції, seed і реалістичний обсяг.
 *   PERF_DATABASE_URL=postgres://cbt:cbt@localhost:5432/cbt_perf npx tsx perf/prepare.ts [--migrations <dir>]
 * --migrations — каталог міграцій іншої версії (щоб заміряти «до» на її схемі).
 *
 * Обсяг (детермінований, щоб прогони можна було порівнювати):
 *   20 терапевтів × 25 клієнтів = 500 клієнтів, по 200 записів (~100 тис.);
 *   «важкий» клієнт Максим: 2000 записів за рік, 10 % видалені; нотатки до кожного 10-го запису.
 */
import pg from 'pg';
import { migrate } from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { seed } from '../src/db/seed.js';
import { PERF } from './config.js';

async function ensureDatabase(url: string): Promise<void> {
  const dbName = new URL(url).pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (rowCount === 0) await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  await client.end();
}

async function main(): Promise<void> {
  const url = process.env.PERF_DATABASE_URL;
  if (!url) throw new Error('PERF_DATABASE_URL is required');
  await ensureDatabase(url);
  const pool = createPool(url);
  const t0 = Date.now();
  try {
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const i = process.argv.indexOf('--migrations');
    await migrate(pool, i >= 0 ? { dir: process.argv[i + 1] } : {});
    await seed(pool);
    await pool.query('SELECT setseed(0.42)');

    // Терапевти та їхні клієнти.
    await pool.query(
      `INSERT INTO users (id, role, name, contacts, therapist_id)
       SELECT gen_random_uuid(), 'therapist', 'Терапевт ' || t, 't' || t || '@example.com', NULL
       FROM generate_series(1, $1) t`,
      [PERF.therapists],
    );
    await pool.query(
      `INSERT INTO users (id, role, name, contacts, therapist_id)
       SELECT gen_random_uuid(), 'client', 'Клієнт ' || th.n || '-' || c, 'c@example.com', th.id
       FROM (SELECT id, row_number() OVER (ORDER BY name) n FROM users
             WHERE role = 'therapist' AND name LIKE 'Терапевт %') th
       CROSS JOIN generate_series(1, $1) c`,
      [PERF.clientsPerTherapist],
    );

    // Записи всіх клієнтів одним INSERT у порядку часу: як у живій системі, записи
    // різних клієнтів перемішані на диску (інакше записи клієнта лежали б поруч,
    // і будь-який запит «за клієнтом» виглядав би нереально дешевим).
    await pool.query(
      `INSERT INTO entries (client_id, situation, thought, emotion, emotion_intensity,
                            rational_response, created_at, deleted_at)
       SELECT client_id, repeat('Ситуація ', 8), repeat('Думка ', 6), emotion,
              (random() * 100)::int, rational_response, created_at, deleted_at
       FROM (
         -- звичайні клієнти: entriesPerClient записів за рік
         SELECT u.id client_id, 'тривога' emotion,
                CASE WHEN random() < 0.5 THEN repeat('Відповідь ', 6) END rational_response,
                now() - random() * interval '365 days' created_at, NULL::timestamptz deleted_at
         FROM users u CROSS JOIN generate_series(1, $1)
         WHERE u.role = 'client' AND u.name LIKE 'Клієнт %'
         UNION ALL
         -- «важкий» клієнт: рік записів, кожен 10-й видалений
         SELECT $2::uuid, 'смуток', repeat('Відповідь ', 6),
                now() - (i * interval '4 hours 22 minutes'),
                CASE WHEN i % 10 = 0 THEN now() - (i * interval '4 hours') END
         FROM generate_series(1, $3) i
       ) generated
       ORDER BY created_at`,
      [PERF.entriesPerClient, PERF.heavyClient, PERF.heavyClientEntries],
    );

    // Нотатки терапевтів до кожного 10-го запису.
    await pool.query(
      `INSERT INTO therapist_notes (entry_id, therapist_id, text, created_at)
       SELECT e.id, u.therapist_id, repeat('Нотатка ', 10), e.created_at + interval '1 hour'
       FROM (SELECT id, client_id, created_at, row_number() OVER () rn FROM entries) e
       JOIN users u ON u.id = e.client_id
       WHERE e.rn % 10 = 0`,
    );
    await pool.query('VACUUM ANALYZE');

    const { rows } = await pool.query<{ users: string; entries: string; notes: string }>(
      `SELECT (SELECT count(*) FROM users) users, (SELECT count(*) FROM entries) entries,
              (SELECT count(*) FROM therapist_notes) notes`,
    );
    process.stdout.write(
      `perf data ready in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${JSON.stringify(rows[0])}\n`,
    );
  } finally {
    await pool.end();
  }
}

await main();
