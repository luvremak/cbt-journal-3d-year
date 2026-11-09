import type { Pool } from '../../db/pool.js';
import type { Page } from '../../lib/pagination.js';
import type { NewNote, Note, NoteRepository } from './note.js';

interface NoteRow {
  id: string;
  entry_id: string;
  therapist_id: string;
  text: string;
  created_at: Date;
}

const COLUMNS = 'id, entry_id, therapist_id, text, created_at';

export class PgNoteRepository implements NoteRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Один SQL-оператор. `FOR SHARE` блокує рядок запису: паралельний
   * `UPDATE ... SET deleted_at` чекає на завершення вставки, а якщо видалення
   * почалося раніше — вставка чекає на нього і перевіряє умову `deleted_at IS NULL`
   * уже на оновленому рядку. Тож результат завжди відповідає послідовному порядку.
   */
  async createIfEntryActive(n: NewNote): Promise<Note | null> {
    const { rows } = await this.pool.query<NoteRow>(
      `INSERT INTO therapist_notes (entry_id, therapist_id, text)
       SELECT e.id, $2, $3
       FROM (SELECT id FROM entries WHERE id = $1 AND deleted_at IS NULL FOR SHARE) e
       RETURNING ${COLUMNS}`,
      [n.entryId, n.therapistId, n.text],
    );
    return rows[0] ? toNote(rows[0]) : null;
  }

  async findByEntry(entryId: string, therapistId: string, page: Page): Promise<Note[]> {
    const { rows } = await this.pool.query<NoteRow>(
      `SELECT ${COLUMNS} FROM therapist_notes
       WHERE entry_id = $1 AND therapist_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3 OFFSET $4`,
      [entryId, therapistId, page.limit, page.offset],
    );
    return rows.map(toNote);
  }
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    entryId: row.entry_id,
    therapistId: row.therapist_id,
    text: row.text,
    createdAt: row.created_at,
  };
}
