import { pathToFileURL } from 'node:url';
import { SEED_ENTRIES, SEED_NOTES, SEED_USERS } from '../seed-data.js';
import type { Pool } from './pool.js';
import { createPool } from './pool.js';

/** Ті самі статичні дані, що й у режимі memory. Повторний запуск нічого не дублює. */
export async function seed(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Спершу терапевти, потім клієнти — через FK therapist_id.
    const users = [
      ...SEED_USERS.filter((u) => u.role === 'therapist'),
      ...SEED_USERS.filter((u) => u.role === 'client'),
    ];
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, role, name, contacts, therapist_id)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [u.id, u.role, u.name, u.contacts, u.therapistId],
      );
    }
    for (const e of SEED_ENTRIES) {
      await client.query(
        `INSERT INTO entries (id, client_id, situation, thought, emotion, emotion_intensity,
                              rational_response, created_at, deleted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO NOTHING`,
        [
          e.id,
          e.clientId,
          e.situation,
          e.thought,
          e.emotion,
          e.emotionIntensity,
          e.rationalResponse,
          e.createdAt,
          e.deletedAt,
        ],
      );
    }
    for (const n of SEED_NOTES) {
      await client.query(
        `INSERT INTO therapist_notes (id, entry_id, therapist_id, text, created_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
        [n.id, n.entryId, n.therapistId, n.text, n.createdAt],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * spec §4: therapist_id кожного клієнта має вказувати на терапевта.
 * FK цього не гарантує; повертає клієнтів, які порушують правило.
 * Цю ж перевірку використає інтеграційний тест у Завданні 3.
 */
export async function findClientsWithInvalidTherapist(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT c.id FROM users c
     LEFT JOIN users t ON t.id = c.therapist_id
     WHERE c.role = 'client' AND (t.id IS NULL OR t.role <> 'therapist')`,
  );
  return rows.map((r) => r.id);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = createPool(url);
  seed(pool)
    .then(() => findClientsWithInvalidTherapist(pool))
    .then((invalid) => {
      if (invalid.length > 0) {
        throw new Error(`Clients with invalid therapist_id: ${invalid.join(', ')}`);
      }
      process.stdout.write('seed done\n');
    })
    .finally(() => pool.end());
}
