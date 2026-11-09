import { ConflictError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { Page } from '../../lib/pagination.js';
import type { EntryService } from '../entries/entry-service.js';
import type { User } from '../users/user.js';
import type { Note, NoteRepository } from './note.js';

export class NoteService {
  constructor(
    private readonly notes: NoteRepository,
    private readonly entries: EntryService,
    private readonly logger: Logger,
  ) {}

  /** spec §4: лише терапевт автора запису (інакше 404); до видаленого запису → 409, атомарно. */
  async create(therapist: User, entryId: string, text: string): Promise<Note> {
    // Права доступу (404). Видалення тут лише швидка відмова: остаточне рішення
    // ухвалює атомарна вставка нижче, бо запис можуть видалити саме зараз.
    const entry = await this.entries.getForTherapist(therapist, entryId);
    if (entry.deletedAt !== null) {
      throw new ConflictError('Cannot add a note to a deleted entry');
    }
    const note = await this.notes.createIfEntryActive({
      entryId: entry.id,
      therapistId: therapist.id,
      text,
    });
    if (!note) {
      this.logger.info({ entryId: entry.id }, 'note rejected: entry deleted concurrently');
      throw new ConflictError('Cannot add a note to a deleted entry');
    }
    this.logger.info({ noteId: note.id, entryId: entry.id }, 'note created');
    return note;
  }

  /** Нотатки лишаються видимими й після видалення запису (spec §7). */
  async list(therapist: User, entryId: string, page: Page): Promise<Note[]> {
    const entry = await this.entries.getForTherapist(therapist, entryId);
    return this.notes.findByEntry(entry.id, therapist.id, page);
  }
}
