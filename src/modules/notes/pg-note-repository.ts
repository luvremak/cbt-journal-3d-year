import type { Pool } from '../../db/pool.js';
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

  async create(n: NewNote): Promise<Note> {
    const { rows } = await this.pool.query<NoteRow>(
      `INSERT INTO therapist_notes (entry_id, therapist_id, text)
       VALUES ($1, $2, $3)
       RETURNING ${COLUMNS}`,
      [n.entryId, n.therapistId, n.text],
    );
    return toNote(rows[0] as NoteRow);
  }

  async findByEntry(entryId: string): Promise<Note[]> {
    const { rows } = await this.pool.query<NoteRow>(
      `SELECT ${COLUMNS} FROM therapist_notes
       WHERE entry_id = $1
       ORDER BY created_at DESC, id DESC`,
      [entryId],
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
