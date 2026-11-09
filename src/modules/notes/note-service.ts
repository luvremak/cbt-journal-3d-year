import { ConflictError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { EntryService } from '../entries/entry-service.js';
import type { User } from '../users/user.js';
import type { Note, NoteRepository } from './note.js';

export class NoteService {
  constructor(
    private readonly notes: NoteRepository,
    private readonly entries: EntryService,
    private readonly logger: Logger,
  ) {}

  /** spec §4: лише терапевт автора запису (інакше 404); до видаленого запису → 409. */
  async create(therapist: User, entryId: string, text: string): Promise<Note> {
    const entry = await this.entries.getForTherapist(therapist, entryId);
    if (entry.deletedAt !== null) {
      throw new ConflictError('Cannot add a note to a deleted entry');
    }
    const note = await this.notes.create({ entryId: entry.id, therapistId: therapist.id, text });
    this.logger.info({ noteId: note.id, entryId: entry.id }, 'note created');
    return note;
  }

  /** Нотатки лишаються видимими й після видалення запису (spec §7). */
  async list(therapist: User, entryId: string): Promise<Note[]> {
    const entry = await this.entries.getForTherapist(therapist, entryId);
    const notes = await this.notes.findByEntry(entry.id);
    return notes.filter((n) => n.therapistId === therapist.id);
  }
}
