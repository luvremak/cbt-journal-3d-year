import { randomUUID } from 'node:crypto';
import type { NewNote, Note, NoteRepository } from './note.js';

export class InMemoryNoteRepository implements NoteRepository {
  private readonly notes: Note[];

  constructor(seed: readonly Note[] = []) {
    this.notes = seed.map(clone);
  }

  async create(data: NewNote): Promise<Note> {
    const note: Note = { ...data, id: randomUUID(), createdAt: new Date() };
    this.notes.push(note);
    return clone(note);
  }

  async findByEntry(entryId: string): Promise<Note[]> {
    return this.notes
      .map((note, index) => ({ note, index }))
      .filter(({ note }) => note.entryId === entryId)
      .sort((a, b) => b.note.createdAt.getTime() - a.note.createdAt.getTime() || b.index - a.index)
      .map(({ note }) => clone(note));
  }
}

function clone(note: Note): Note {
  return { ...note, createdAt: new Date(note.createdAt) };
}
