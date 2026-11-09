import { randomUUID } from 'node:crypto';
import { compareNewestFirst, slicePage, type Page } from '../../lib/pagination.js';
import type { NewNote, Note, NoteRepository } from './note.js';

/** Те, що потрібно від сховища записів: синхронна перевірка активності. */
export interface ActiveEntryChecker {
  isActive(entryId: string): boolean;
}

export class InMemoryNoteRepository implements NoteRepository {
  private readonly notes: Note[];

  constructor(
    private readonly entries: ActiveEntryChecker,
    seed: readonly Note[] = [],
  ) {
    this.notes = seed.map(clone);
  }

  async createIfEntryActive(data: NewNote): Promise<Note | null> {
    // Перевірка і вставка в одному синхронному блоці: між ними немає await,
    // тож паралельне видалення не може вклинитися (Node.js — один потік).
    if (!this.entries.isActive(data.entryId)) return null;
    const note: Note = { ...data, id: randomUUID(), createdAt: new Date() };
    this.notes.push(note);
    return clone(note);
  }

  async findByEntry(entryId: string, therapistId: string, page: Page): Promise<Note[]> {
    const notes = this.notes
      .filter((n) => n.entryId === entryId && n.therapistId === therapistId)
      .sort(compareNewestFirst);
    return slicePage(notes, page).map(clone);
  }
}

function clone(note: Note): Note {
  return { ...note, createdAt: new Date(note.createdAt) };
}
