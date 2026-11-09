export interface Note {
  id: string;
  entryId: string;
  therapistId: string;
  text: string;
  createdAt: Date;
}

export type NewNote = Pick<Note, 'entryId' | 'therapistId' | 'text'>;

export interface NoteRepository {
  create(note: NewNote): Promise<Note>;
  /** Нотатки до запису від нових до старих (spec §4). */
  findByEntry(entryId: string): Promise<Note[]>;
}
