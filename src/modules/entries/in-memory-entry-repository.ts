import { randomUUID } from 'node:crypto';
import type { Entry, EntryRepository, NewEntry } from './entry.js';

export class InMemoryEntryRepository implements EntryRepository {
  private readonly entries: Entry[];

  constructor(seed: readonly Entry[] = []) {
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

  async findByClient(clientId: string, options: { includeDeleted: boolean }): Promise<Entry[]> {
    return (
      this.entries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.clientId === clientId)
        .filter(({ entry }) => options.includeDeleted || entry.deletedAt === null)
        // Від нових до старих; за однакового часу — пізніше доданий вище.
        .sort(
          (a, b) => b.entry.createdAt.getTime() - a.entry.createdAt.getTime() || b.index - a.index,
        )
        .map(({ entry }) => clone(entry))
    );
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
