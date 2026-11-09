/**
 * Контрактні тести: in-memory і PostgreSQL репозиторії мусять поводитися однаково,
 * інакше тести сервісів на in-memory нічого не гарантували б для продакшну.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from '../../src/db/pool.js';
import type { EntryRepository } from '../../src/modules/entries/entry.js';
import { InMemoryEntryRepository } from '../../src/modules/entries/in-memory-entry-repository.js';
import { PgEntryRepository } from '../../src/modules/entries/pg-entry-repository.js';
import { InMemoryNoteRepository } from '../../src/modules/notes/in-memory-note-repository.js';
import type { NoteRepository } from '../../src/modules/notes/note.js';
import { PgNoteRepository } from '../../src/modules/notes/pg-note-repository.js';
import { InMemoryUserRepository } from '../../src/modules/users/in-memory-user-repository.js';
import { PgUserRepository } from '../../src/modules/users/pg-user-repository.js';
import type { User, UserRepository } from '../../src/modules/users/user.js';
import { SEED_ENTRIES, SEED_IDS, SEED_NOTES, SEED_USERS } from '../../src/seed-data.js';
import { createTestPool, hasDb, resetDb } from '../helpers/db.js';

interface Repos {
  users: UserRepository;
  entries: EntryRepository;
  notes: NoteRepository;
}

const PAGE = { limit: 50, offset: 0 };
const UNKNOWN = '99999999-9999-4999-8999-999999999999';
const newEntry = {
  clientId: SEED_IDS.clientMaksym,
  situation: 'S',
  thought: 'T',
  emotion: 'E',
  emotionIntensity: 10,
  rationalResponse: null,
};

/** Додаткові клієнти терапевта Андрія понад seed (у seed у нього вже є Софія). */
function clientsOfAndrii(extra: [name: string, id: string][]): User[] {
  return extra.map(([name, id]) => ({
    id,
    role: 'client',
    name,
    contacts: 'x',
    therapistId: SEED_IDS.therapistAndrii,
  }));
}

type Setup = (extraUsers?: User[]) => Promise<Repos>;

function contract(name: string, setup: Setup, skip = false) {
  describe.skipIf(skip)(`repository contract [${name}]`, () => {
    let r: Repos;
    beforeEach(async () => {
      r = await setup();
    });

    describe('users', () => {
      it('findById returns the domain user or null', async () => {
        expect(await r.users.findById(SEED_IDS.clientIryna)).toEqual(
          SEED_USERS.find((u) => u.id === SEED_IDS.clientIryna),
        );
        expect(await r.users.findById(UNKNOWN)).toBeNull();
      });

      it('findClientsByTherapist: Ukrainian alphabet, case-insensitive, then id (spec §4)', async () => {
        const repos = await setup(
          clientsOfAndrii([
            ['Євген', 'eeeeeeee-0000-4000-8000-000000000001'],
            ['Андрій', 'eeeeeeee-0000-4000-8000-000000000002'],
            ['Ірина', 'eeeeeeee-0000-4000-8000-000000000003'],
            ['Богдан', 'eeeeeeee-0000-4000-8000-000000000004'],
            ['андрій', 'eeeeeeee-0000-4000-8000-000000000000'],
          ]),
        );
        const list = await repos.users.findClientsByTherapist(SEED_IDS.therapistAndrii, PAGE);
        // «андрій» і «Андрій» рівні без урахування регістру → далі за id.
        expect(list.map((u) => u.name)).toEqual([
          'андрій',
          'Андрій',
          'Богдан',
          'Євген',
          'Ірина',
          'Софія',
        ]);
      });

      it('findClientsByTherapist: only clients of that therapist, by name, paginated', async () => {
        const all = await r.users.findClientsByTherapist(SEED_IDS.therapistOlena, PAGE);
        expect(all.map((u) => u.name)).toEqual(['Ірина', 'Максим']);
        const page = await r.users.findClientsByTherapist(SEED_IDS.therapistOlena, {
          limit: 1,
          offset: 1,
        });
        expect(page.map((u) => u.name)).toEqual(['Максим']);
        expect(await r.users.findClientsByTherapist(SEED_IDS.clientIryna, PAGE)).toEqual([]);
      });
    });

    describe('entries', () => {
      it('create returns a full active entry with generated id and time', async () => {
        const before = Date.now();
        const e = await r.entries.create({ ...newEntry, rationalResponse: 'R' });
        expect(e).toMatchObject({ ...newEntry, rationalResponse: 'R', deletedAt: null });
        expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(e.createdAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
        expect(await r.entries.findById(e.id)).toEqual(e);
      });

      it('findById of unknown → null', async () => {
        expect(await r.entries.findById(UNKNOWN)).toBeNull();
      });

      it('findByClient: newest first; deleted only with includeDeleted', async () => {
        await r.entries.softDelete(SEED_IDS.entryIryna2);
        const active = await r.entries.findByClient(SEED_IDS.clientIryna, {
          includeDeleted: false,
          page: PAGE,
        });
        expect(active.map((e) => e.id)).toEqual([SEED_IDS.entryIryna1]);
        const all = await r.entries.findByClient(SEED_IDS.clientIryna, {
          includeDeleted: true,
          page: PAGE,
        });
        expect(all.map((e) => e.id)).toEqual([SEED_IDS.entryIryna2, SEED_IDS.entryIryna1]);
        expect(all[0]?.deletedAt).toBeInstanceOf(Date);
      });

      it('findByClient paginates', async () => {
        const opts = (offset: number) => ({ includeDeleted: false, page: { limit: 1, offset } });
        expect(
          (await r.entries.findByClient(SEED_IDS.clientIryna, opts(0))).map((e) => e.id),
        ).toEqual([SEED_IDS.entryIryna2]);
        expect(
          (await r.entries.findByClient(SEED_IDS.clientIryna, opts(1))).map((e) => e.id),
        ).toEqual([SEED_IDS.entryIryna1]);
        expect(await r.entries.findByClient(SEED_IDS.clientIryna, opts(2))).toEqual([]);
      });

      it('softDelete: true once, then false; unknown → false', async () => {
        expect(await r.entries.softDelete(SEED_IDS.entryIryna1)).toBe(true);
        expect(await r.entries.softDelete(SEED_IDS.entryIryna1)).toBe(false);
        expect(await r.entries.softDelete(UNKNOWN)).toBe(false);
        expect((await r.entries.findById(SEED_IDS.entryIryna1))?.deletedAt).toBeInstanceOf(Date);
      });
    });

    describe('notes', () => {
      it('createIfEntryActive on an active entry stores the note', async () => {
        const n = await r.notes.createIfEntryActive({
          entryId: SEED_IDS.entryIryna2,
          therapistId: SEED_IDS.therapistOlena,
          text: 'x',
        });
        expect(n).toMatchObject({
          entryId: SEED_IDS.entryIryna2,
          therapistId: SEED_IDS.therapistOlena,
          text: 'x',
        });
        expect(n?.createdAt).toBeInstanceOf(Date);
        const list = await r.notes.findByEntry(SEED_IDS.entryIryna2, SEED_IDS.therapistOlena, PAGE);
        expect(list).toEqual([n]);
      });

      it('createIfEntryActive on a deleted or unknown entry → null', async () => {
        await r.entries.softDelete(SEED_IDS.entryIryna2);
        const note = { therapistId: SEED_IDS.therapistOlena, text: 'x' };
        expect(
          await r.notes.createIfEntryActive({ ...note, entryId: SEED_IDS.entryIryna2 }),
        ).toBeNull();
        expect(await r.notes.createIfEntryActive({ ...note, entryId: UNKNOWN })).toBeNull();
      });

      it('findByEntry: newest first, only that therapist, paginated', async () => {
        const n = await r.notes.createIfEntryActive({
          entryId: SEED_IDS.entryIryna1,
          therapistId: SEED_IDS.therapistOlena,
          text: 'new',
        });
        const list = await r.notes.findByEntry(SEED_IDS.entryIryna1, SEED_IDS.therapistOlena, PAGE);
        expect(list.map((x) => x.id)).toEqual([n?.id, SEED_IDS.noteIryna1]);
        expect(
          await r.notes.findByEntry(SEED_IDS.entryIryna1, SEED_IDS.therapistAndrii, PAGE),
        ).toEqual([]);
        const p2 = await r.notes.findByEntry(SEED_IDS.entryIryna1, SEED_IDS.therapistOlena, {
          limit: 1,
          offset: 1,
        });
        expect(p2.map((x) => x.id)).toEqual([SEED_IDS.noteIryna1]);
      });
    });
  });
}

contract('memory', async (extraUsers = []) => {
  const entries = new InMemoryEntryRepository(SEED_ENTRIES);
  return {
    users: new InMemoryUserRepository([...SEED_USERS, ...extraUsers]),
    entries,
    notes: new InMemoryNoteRepository(entries, SEED_NOTES),
  };
});

let pool: Pool | undefined;
beforeAll(() => {
  if (hasDb) pool = createTestPool();
});
afterAll(async () => {
  await pool?.end();
});

contract(
  'postgres',
  async (extraUsers = []) => {
    if (!pool) throw new Error('no pool');
    await resetDb(pool);
    for (const u of extraUsers) {
      await pool.query(
        'INSERT INTO users (id, role, name, contacts, therapist_id) VALUES ($1, $2, $3, $4, $5)',
        [u.id, u.role, u.name, u.contacts, u.therapistId],
      );
    }
    return {
      users: new PgUserRepository(pool),
      entries: new PgEntryRepository(pool),
      notes: new PgNoteRepository(pool),
    };
  },
  !hasDb,
);
