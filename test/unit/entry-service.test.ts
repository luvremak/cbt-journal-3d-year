import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/lib/errors.js';
import { InMemoryEntryRepository } from '../../src/modules/entries/in-memory-entry-repository.js';
import { EntryService } from '../../src/modules/entries/entry-service.js';
import { SEED_IDS } from '../../src/seed-data.js';
import {
  andrii,
  createServices,
  iryna,
  maksym,
  olena,
  PAGE,
  silentLogger,
  sofiia,
  validEntry,
} from '../helpers/fakes.js';

const UNKNOWN = '99999999-9999-4999-8999-999999999999';

describe('EntryService — client', () => {
  it('creates an entry owned by the client and logs it', async () => {
    const { entries, logs } = createServices();
    const e = await entries.create(maksym(), validEntry);
    expect(logs).toContainEqual(
      expect.objectContaining({ level: 30, msg: 'entry created', entryId: e.id }),
    );
    expect(e).toMatchObject({ ...validEntry, clientId: SEED_IDS.clientMaksym, deletedAt: null });
    expect(e.createdAt).toBeInstanceOf(Date);
    expect((await entries.listForClient(maksym(), PAGE)).map((x) => x.id)).toEqual([e.id]);
  });

  it('lists only own active entries, newest first (spec §4)', async () => {
    const { entries } = createServices();
    const list = await entries.listForClient(iryna(), PAGE);
    expect(list.map((e) => e.id)).toEqual([SEED_IDS.entryIryna2, SEED_IDS.entryIryna1]);
    expect(await entries.listForClient(maksym(), PAGE)).toEqual([]);
  });

  it('list is paginated', async () => {
    const { entries } = createServices();
    const page2 = await entries.listForClient(iryna(), { limit: 1, offset: 1 });
    expect(page2.map((e) => e.id)).toEqual([SEED_IDS.entryIryna1]);
  });

  it('gets own entry', async () => {
    const { entries } = createServices();
    expect((await entries.getForClient(iryna(), SEED_IDS.entryIryna1)).id).toBe(
      SEED_IDS.entryIryna1,
    );
  });

  it.each([
    ['foreign entry', SEED_IDS.entrySofiia1],
    ['unknown id', UNKNOWN],
    ['non-uuid', 'abc'],
  ])('getForClient: %s → 404', async (_n, id) => {
    const { entries } = createServices();
    await expect(entries.getForClient(iryna(), id)).rejects.toThrow(
      new NotFoundError('Entry not found'),
    );
  });

  it('soft delete hides the entry from the client (spec §4)', async () => {
    const { entries, entryRepo, logs } = createServices();
    await entries.deleteForClient(iryna(), SEED_IDS.entryIryna1);
    expect(logs).toContainEqual(
      expect.objectContaining({ msg: 'entry soft-deleted', entryId: SEED_IDS.entryIryna1 }),
    );
    expect((await entries.listForClient(iryna(), PAGE)).map((e) => e.id)).toEqual([
      SEED_IDS.entryIryna2,
    ]);
    await expect(entries.getForClient(iryna(), SEED_IDS.entryIryna1)).rejects.toThrow(
      NotFoundError,
    );
    // Фізично запис лишився (soft delete).
    expect((await entryRepo.findById(SEED_IDS.entryIryna1))?.deletedAt).toBeInstanceOf(Date);
  });

  it('repeat delete → 404, foreign delete → 404 (spec §7)', async () => {
    const { entries } = createServices();
    await entries.deleteForClient(iryna(), SEED_IDS.entryIryna1);
    await expect(entries.deleteForClient(iryna(), SEED_IDS.entryIryna1)).rejects.toThrow(
      NotFoundError,
    );
    await expect(entries.deleteForClient(iryna(), SEED_IDS.entrySofiia1)).rejects.toThrow(
      NotFoundError,
    );
  });

  it('delete that loses a race (repository reports nothing changed) → 404', async () => {
    const { users } = createServices();
    const repo = new InMemoryEntryRepository([]);
    expect(
      await repo.findByClient(SEED_IDS.clientIryna, { includeDeleted: true, page: PAGE }),
    ).toEqual([]);
    const e = await repo.create({ ...validEntry, clientId: SEED_IDS.clientIryna });
    vi.spyOn(repo, 'softDelete').mockResolvedValue(false);
    const svc = new EntryService(repo, users, silentLogger);
    await expect(svc.deleteForClient(iryna(), e.id)).rejects.toThrow(
      new NotFoundError('Entry not found'),
    );
  });
});

describe('EntryService — therapist', () => {
  it('lists own client entries including deleted ones (spec §4)', async () => {
    const { entries } = createServices();
    await entries.deleteForClient(iryna(), SEED_IDS.entryIryna1);
    const list = await entries.listForTherapist(olena(), SEED_IDS.clientIryna, PAGE);
    expect(list.map((e) => [e.id, e.deletedAt !== null])).toEqual([
      [SEED_IDS.entryIryna2, false],
      [SEED_IDS.entryIryna1, true],
    ]);
  });

  it('list is paginated', async () => {
    const { entries } = createServices();
    const list = await entries.listForTherapist(olena(), SEED_IDS.clientIryna, {
      limit: 1,
      offset: 0,
    });
    expect(list.map((e) => e.id)).toEqual([SEED_IDS.entryIryna2]);
  });

  it('foreign client → 404 (spec §7)', async () => {
    const { entries } = createServices();
    await expect(entries.listForTherapist(andrii(), SEED_IDS.clientIryna, PAGE)).rejects.toThrow(
      new NotFoundError('Client not found'),
    );
  });

  it('getForTherapist: own client entry, also when deleted', async () => {
    const { entries } = createServices();
    expect((await entries.getForTherapist(olena(), SEED_IDS.entryIryna1)).id).toBe(
      SEED_IDS.entryIryna1,
    );
    await entries.deleteForClient(iryna(), SEED_IDS.entryIryna1);
    expect((await entries.getForTherapist(olena(), SEED_IDS.entryIryna1)).deletedAt).not.toBeNull();
  });

  it.each([
    ['foreign client entry', SEED_IDS.entrySofiia1],
    ['unknown', UNKNOWN],
    ['non-uuid', 'abc'],
  ])('getForTherapist: %s → 404 "Entry not found"', async (_n, id) => {
    const { entries } = createServices();
    await expect(entries.getForTherapist(olena(), id)).rejects.toThrow(
      new NotFoundError('Entry not found'),
    );
  });

  it('getForTherapist does not swallow unexpected errors', async () => {
    const { entryRepo, users } = createServices();
    vi.spyOn(users, 'getOwnClient').mockRejectedValue(new Error('db down'));
    const svc = new EntryService(entryRepo, users, silentLogger);
    await expect(svc.getForTherapist(olena(), SEED_IDS.entryIryna1)).rejects.toThrow('db down');
  });

  it('a client cannot be used as a therapist', async () => {
    const { entries } = createServices();
    await expect(entries.listForTherapist(sofiia(), SEED_IDS.clientIryna, PAGE)).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe('InMemoryEntryRepository', () => {
  it('returns copies (mutating a result does not change storage)', async () => {
    const { entryRepo } = createServices();
    const e = await entryRepo.findById(SEED_IDS.entryIryna1);
    if (!e) throw new Error('seed missing');
    e.situation = 'changed';
    e.createdAt.setFullYear(2000);
    expect((await entryRepo.findById(SEED_IDS.entryIryna1))?.situation).not.toBe('changed');
    expect((await entryRepo.findById(SEED_IDS.entryIryna1))?.createdAt.getFullYear()).toBe(2026);
  });

  it('softDelete only once; isActive reflects it', async () => {
    const { entryRepo } = createServices();
    expect(entryRepo.isActive(SEED_IDS.entryIryna1)).toBe(true);
    expect(await entryRepo.softDelete(SEED_IDS.entryIryna1)).toBe(true);
    expect(await entryRepo.softDelete(SEED_IDS.entryIryna1)).toBe(false);
    expect(entryRepo.isActive(SEED_IDS.entryIryna1)).toBe(false);
    expect(entryRepo.isActive(UNKNOWN)).toBe(false);
    expect(await entryRepo.softDelete(UNKNOWN)).toBe(false);
  });

  it('deleted copy keeps its deletedAt date', async () => {
    const { entryRepo } = createServices();
    await entryRepo.softDelete(SEED_IDS.entryIryna1);
    const [list] = [
      await entryRepo.findByClient(SEED_IDS.clientIryna, { includeDeleted: true, page: PAGE }),
    ];
    expect(list.find((e) => e.id === SEED_IDS.entryIryna1)?.deletedAt).toBeInstanceOf(Date);
  });
});
