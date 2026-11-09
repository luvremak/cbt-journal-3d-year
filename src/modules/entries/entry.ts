import type { Page } from '../../lib/pagination.js';

export interface Entry {
  id: string;
  clientId: string;
  situation: string;
  thought: string;
  emotion: string;
  emotionIntensity: number;
  rationalResponse: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export type NewEntry = Pick<
  Entry,
  'clientId' | 'situation' | 'thought' | 'emotion' | 'emotionIntensity' | 'rationalResponse'
>;

export interface EntryRepository {
  create(entry: NewEntry): Promise<Entry>;
  findById(id: string): Promise<Entry | null>;
  /** Сторінка записів клієнта: від нових до старих, за однакового часу — за id (spec §4). */
  findByClient(
    clientId: string,
    options: { includeDeleted: boolean; page: Page },
  ): Promise<Entry[]>;
  /** Позначає запис видаленим, якщо він ще активний. Повертає false, якщо нічого не змінено. */
  softDelete(id: string): Promise<boolean>;
}
