import { randomUUID } from 'node:crypto';
import { compareNewestFirst, slicePage, type Page } from '../../lib/pagination.js';
import type { Entry, EntryRepository, NewEntry } from './entry.js';

export class InMemoryEntryRepository implements EntryRepository {
  private readonly entries: Entry[];

  constructor(seed: readonly Entry[]) {
    this.entries = seed.map(clone);
  }

  async create(data: NewEntry): Promise<Entry> {
    const entry: Entry = { ...data, id: randomUUID(), createdAt: new Date(), deletedAt: null };
    this.entries.push(entry);
    return clone(entry);
  }

  async findById(id: string): Promise<Entry | null> {
    const entry = this.entries.find((e) => e.id === id);
    return entry ? clone(entry) : null;
  }

  async findByClient(
    clientId: string,
    options: { includeDeleted: boolean; page: Page },
  ): Promise<Entry[]> {
    const entries = this.entries
      .filter((e) => e.clientId === clientId)
      .filter((e) => options.includeDeleted || e.deletedAt === null)
      .sort(compareNewestFirst);
    return slicePage(entries, options.page).map(clone);
  }

  /** Синхронна перевірка — щоб нотатка створювалась атомарно (без await між перевіркою і вставкою). */
  isActive(id: string): boolean {
    return this.entries.some((e) => e.id === id && e.deletedAt === null);
  }

  async softDelete(id: string): Promise<boolean> {
    const entry = this.entries.find((e) => e.id === id && e.deletedAt === null);
    if (!entry) return false;
    entry.deletedAt = new Date();
    return true;
  }
}

function clone(entry: Entry): Entry {
  return {
    ...entry,
    createdAt: new Date(entry.createdAt),
    deletedAt: entry.deletedAt ? new Date(entry.deletedAt) : null,
  };
}
