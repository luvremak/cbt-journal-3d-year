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
    const { rows } = await this.pool.query<EntryRow>(
      `SELECT ${COLUMNS} FROM entries
       WHERE client_id = $1 AND ($2 OR deleted_at IS NULL)
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [clientId, options.includeDeleted, options.page.limit, options.page.offset],
    );
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
