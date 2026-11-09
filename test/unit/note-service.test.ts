import { describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '../../src/lib/errors.js';
import { NoteService } from '../../src/modules/notes/note-service.js';
import { InMemoryNoteRepository } from '../../src/modules/notes/in-memory-note-repository.js';
import { SEED_IDS } from '../../src/seed-data.js';
import { andrii, createServices, iryna, olena, PAGE, silentLogger } from '../helpers/fakes.js';

describe('NoteService (spec §4 notes)', () => {
  it('therapist of the author creates a note', async () => {
    const { notes } = createServices();
    const n = await notes.create(olena(), SEED_IDS.entryIryna2, 'Нотатка');
    expect(n).toMatchObject({
      entryId: SEED_IDS.entryIryna2,
      therapistId: SEED_IDS.therapistOlena,
      text: 'Нотатка',
    });
    expect((await notes.list(olena(), SEED_IDS.entryIryna2, PAGE)).map((x) => x.id)).toEqual([
      n.id,
    ]);
  });

  it('other therapist → 404 for create and list (spec §7)', async () => {
    const { notes } = createServices();
    await expect(notes.create(andrii(), SEED_IDS.entryIryna1, 'x')).rejects.toThrow(NotFoundError);
    await expect(notes.list(andrii(), SEED_IDS.entryIryna1, PAGE)).rejects.toThrow(NotFoundError);
  });

  it('note on a deleted entry → 409', async () => {
    const { notes, entries } = createServices();
    await entries.deleteForClient(iryna(), SEED_IDS.entryIryna1);
    await expect(notes.create(olena(), SEED_IDS.entryIryna1, 'x')).rejects.toThrow(
      new ConflictError('Cannot add a note to a deleted entry'),
    );
  });

  it('entry deleted between the check and the insert → 409, nothing stored (atomicity)', async () => {
    const { noteRepo, entries } = createServices();
    const svc = new NoteService(noteRepo, entries, silentLogger);
    const realCreate = noteRepo.createIfEntryActive.bind(noteRepo);
    vi.spyOn(noteRepo, 'createIfEntryActive').mockImplementation(async (note) => {
      await entries.deleteForClient(iryna(), SEED_IDS.entryIryna2); // «паралельне» видалення
      return realCreate(note);
    });
    await expect(svc.create(olena(), SEED_IDS.entryIryna2, 'x')).rejects.toThrow(ConflictError);
    expect(await noteRepo.findByEntry(SEED_IDS.entryIryna2, SEED_IDS.therapistOlena, PAGE)).toEqual(
      [],
    );
  });

  it('notes stay visible after the entry is deleted (spec §7)', async () => {
    const { notes, entries } = createServices();
    await entries.deleteForClient(iryna(), SEED_IDS.entryIryna1);
    const list = await notes.list(olena(), SEED_IDS.entryIryna1, PAGE);
    expect(list.map((n) => n.id)).toEqual([SEED_IDS.noteIryna1]);
  });

  it('notes are newest first and paginated', async () => {
    const { notes } = createServices();
    const a = await notes.create(olena(), SEED_IDS.entryIryna1, 'a');
    await new Promise((r) => setTimeout(r, 2));
    const b = await notes.create(olena(), SEED_IDS.entryIryna1, 'b');
    const all = await notes.list(olena(), SEED_IDS.entryIryna1, PAGE);
    expect(all.map((n) => n.id)).toEqual([b.id, a.id, SEED_IDS.noteIryna1]);
    const page = await notes.list(olena(), SEED_IDS.entryIryna1, { limit: 1, offset: 1 });
    expect(page.map((n) => n.id)).toEqual([a.id]);
  });
});

describe('InMemoryNoteRepository', () => {
  it('lists only the given therapist notes for the entry', async () => {
    const repo = new InMemoryNoteRepository({ isActive: () => true });
    await repo.createIfEntryActive({ entryId: 'e1', therapistId: 't1', text: 'mine' });
    await repo.createIfEntryActive({ entryId: 'e1', therapistId: 't2', text: 'other' });
    await repo.createIfEntryActive({ entryId: 'e2', therapistId: 't1', text: 'other entry' });
    expect((await repo.findByEntry('e1', 't1', PAGE)).map((n) => n.text)).toEqual(['mine']);
  });

  it('createIfEntryActive returns null and stores nothing for inactive entries', async () => {
    const repo = new InMemoryNoteRepository({ isActive: () => false });
    expect(
      await repo.createIfEntryActive({ entryId: 'e1', therapistId: 't1', text: 'x' }),
    ).toBeNull();
    expect(await repo.findByEntry('e1', 't1', PAGE)).toEqual([]);
  });

  it('returns copies', async () => {
    const repo = new InMemoryNoteRepository({ isActive: () => true });
    const n = await repo.createIfEntryActive({ entryId: 'e1', therapistId: 't1', text: 'x' });
    n?.createdAt.setFullYear(2000);
    expect((await repo.findByEntry('e1', 't1', PAGE))[0]?.createdAt.getFullYear()).not.toBe(2000);
  });
});
