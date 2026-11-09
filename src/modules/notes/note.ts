import type { Page } from '../../lib/pagination.js';

export interface Note {
  id: string;
  entryId: string;
  therapistId: string;
  text: string;
  createdAt: Date;
}

export type NewNote = Pick<Note, 'entryId' | 'therapistId' | 'text'>;

export interface NoteRepository {
  /**
   * Створює нотатку, лише якщо запис ще не видалено. Перевірка і вставка атомарні
   * й не перемежовуються з видаленням (spec §4). Повертає null, якщо запис видалено.
   */
  createIfEntryActive(note: NewNote): Promise<Note | null>;
  /** Сторінка нотаток терапевта до запису: від нових до старих, далі за id (spec §4). */
  findByEntry(entryId: string, therapistId: string, page: Page): Promise<Note[]>;
}
