import type { Pool } from '../../db/pool.js';
import type { Page } from '../../lib/pagination.js';
import type { Entry, EntryRepository, NewEntry } from './entry.js';

interface EntryRow {
  id: string;
  client_id: string;
  situation: string;
  thought: string;
  emotion: string;
  emotion_intensity: number;
  rational_response: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

const COLUMNS = `id, client_id, situation, thought, emotion, emotion_intensity,
                 rational_response, created_at, deleted_at`;
/** З якого offset вигідніший deferred join (заміри на 100 тис. записів, perf/README.md). */
export const DEFERRED_JOIN_MIN_OFFSET = 200;

const PREFIXED_COLUMNS = COLUMNS.split(',')
  .map((c) => `e.${c.trim()}`)
  .join(', ');

export class PgEntryRepository implements EntryRepository {
  constructor(private readonly pool: Pool) {}

  async create(e: NewEntry): Promise<Entry> {
    const { rows } = await this.pool.query<EntryRow>(
      `INSERT INTO entries (client_id, situation, thought, emotion, emotion_intensity, rational_response)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLUMNS}`,
      [e.clientId, e.situation, e.thought, e.emotion, e.emotionIntensity, e.rationalResponse],
    );
    return toEntry(rows[0] as EntryRow);
  }

  async findById(id: string): Promise<Entry | null> {
    const { rows } = await this.pool.query<EntryRow>(
      `SELECT ${COLUMNS} FROM entries WHERE id = $1`,
      [id],
    );
    return rows[0] ? toEntry(rows[0]) : null;
  }

  async findByClient(
    clientId: string,
    options: { includeDeleted: boolean; page: Page },
  ): Promise<Entry[]> {
    // Окремі SQL для «активних» і «всіх», щоб планувальник брав відповідний індекс:
    // частковий entries_client_active_page_idx або повний entries_client_page_idx.
    const deletedFilter = options.includeDeleted ? '' : 'AND deleted_at IS NULL';
    const { limit, offset } = options.page;
    // Глибокі сторінки — deferred join: id сторінки шукаємо лише за індексом (index-only
    // scan, без читання таблиці для пропущених offset-рядків), повні рядки — лише для
    // limit штук. На перших сторінках простий запит дешевший (perf/README.md: поріг 200).
    const sql =
      offset >= DEFERRED_JOIN_MIN_OFFSET
        ? `SELECT ${PREFIXED_COLUMNS}
           FROM (SELECT id, created_at FROM entries
                 WHERE client_id = $1 ${deletedFilter}
                 ORDER BY created_at DESC, id DESC
                 LIMIT $2 OFFSET $3) page
           JOIN entries e ON e.id = page.id
           ORDER BY page.created_at DESC, page.id DESC`
        : `SELECT ${COLUMNS} FROM entries
           WHERE client_id = $1 ${deletedFilter}
           ORDER BY created_at DESC, id DESC
           LIMIT $2 OFFSET $3`;
    const { rows } = await this.pool.query<EntryRow>(sql, [clientId, limit, offset]);
    return rows.map(toEntry);
  }

  /**
   * clock_timestamp(), а не now(): now() — час початку запиту, а видалення могло
   * чекати на паралельну нотатку (FOR SHARE). Тоді deleted_at був би раніше за
   * created_at нотатки, хоча нотатку створено першою (spec §4, послідовний порядок).
   */
  async softDelete(id: string): Promise<boolean> {
    const result = await this.pool.query(
      'UPDATE entries SET deleted_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    return result.rowCount === 1;
  }
}

function toEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    clientId: row.client_id,
    situation: row.situation,
    thought: row.thought,
    emotion: row.emotion,
    emotionIntensity: row.emotion_intensity,
    rationalResponse: row.rational_response,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
  };
}
