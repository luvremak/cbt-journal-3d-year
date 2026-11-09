import { describe, expect, it } from 'vitest';
import { NotFoundError, UnauthorizedError } from '../../src/lib/errors.js';
import {
  compareByNameThenId,
  InMemoryUserRepository,
} from '../../src/modules/users/in-memory-user-repository.js';
import { UserService } from '../../src/modules/users/user-service.js';
import { SEED_IDS } from '../../src/seed-data.js';
import {
  andrii,
  createServices,
  iryna,
  olena,
  PAGE,
  silentLogger,
  sofiia,
} from '../helpers/fakes.js';

describe('UserService.authenticate (spec §7 X-User-Id)', () => {
  const { users } = createServices();

  it.each([undefined, ''])('missing header %o → 401', async (v) => {
    await expect(users.authenticate(v)).rejects.toThrow(
      new UnauthorizedError('X-User-Id header is required'),
    );
  });

  it('non-UUID → 401', async () => {
    await expect(users.authenticate('abc')).rejects.toThrow(
      new UnauthorizedError('X-User-Id must be a valid UUID'),
    );
  });

  it('unknown user → 401', async () => {
    await expect(users.authenticate('99999999-9999-4999-8999-999999999999')).rejects.toThrow(
      new UnauthorizedError('Unknown user'),
    );
  });

  it('known user is returned', async () => {
    expect(await users.authenticate(SEED_IDS.clientIryna)).toEqual(iryna());
  });
});

describe('UserService: client ↔ therapist', () => {
  const { users } = createServices();

  it('client sees name and contacts of their therapist only (spec §2)', async () => {
    expect(await users.getTherapistOf(iryna())).toEqual({
      id: SEED_IDS.therapistOlena,
      name: 'Олена Коваль',
      contacts: olena().contacts,
    });
    expect((await users.getTherapistOf(sofiia())).id).toBe(SEED_IDS.therapistAndrii);
  });

  it('client without an existing therapist → 404 (data integrity guard), logged as error', async () => {
    const { users, logs } = createServices();
    const broken = { ...iryna(), therapistId: null };
    await expect(users.getTherapistOf(broken)).rejects.toThrow(NotFoundError);
    expect(logs).toContainEqual(
      expect.objectContaining({
        level: 50,
        msg: 'client has no therapist',
        clientId: SEED_IDS.clientIryna,
      }),
    );
    const dangling = { ...iryna(), therapistId: '99999999-9999-4999-8999-999999999999' };
    await expect(users.getTherapistOf(dangling)).rejects.toThrow('Therapist not found');
  });

  it('therapist lists only own clients, with name and contacts, sorted by name (spec §2)', async () => {
    const list = await users.listClientsOf(olena(), PAGE);
    expect(list).toEqual([
      { id: SEED_IDS.clientIryna, name: 'Ірина', contacts: 'iryna@example.com' },
      { id: SEED_IDS.clientMaksym, name: 'Максим', contacts: 'maksym@example.com' },
    ]);
    expect((await users.listClientsOf(andrii(), PAGE)).map((c) => c.name)).toEqual(['Софія']);
  });

  it('client list is paginated', async () => {
    expect(
      (await users.listClientsOf(olena(), { limit: 1, offset: 1 })).map((c) => c.name),
    ).toEqual(['Максим']);
  });

  it('getOwnClient returns own client', async () => {
    expect((await users.getOwnClient(olena(), SEED_IDS.clientIryna)).id).toBe(SEED_IDS.clientIryna);
  });

  it.each([
    ['other therapist client', SEED_IDS.clientSofiia],
    ['a therapist id', SEED_IDS.therapistOlena],
    ['unknown id', '99999999-9999-4999-8999-999999999999'],
    ['non-uuid', 'abc'],
  ])('getOwnClient: %s → 404 (spec §7)', async (_name, id) => {
    await expect(users.getOwnClient(olena(), id)).rejects.toThrow(
      new NotFoundError('Client not found'),
    );
  });

  it('getOwnClient: a client with the right therapistId but role therapist is not a client', async () => {
    const fakeClient = {
      ...olena(),
      id: '33333333-3333-4333-8333-333333333333',
      therapistId: olena().id,
    };
    const svc = new UserService(new InMemoryUserRepository([olena(), fakeClient]), silentLogger);
    await expect(svc.getOwnClient(olena(), fakeClient.id)).rejects.toThrow(NotFoundError);
  });
});

describe('InMemoryUserRepository', () => {
  it('returns copies, not internal objects', async () => {
    const repo = new InMemoryUserRepository([iryna()]);
    const u = await repo.findById(SEED_IDS.clientIryna);
    if (u) u.name = 'changed';
    expect((await repo.findById(SEED_IDS.clientIryna))?.name).toBe('Ірина');
  });

  it('ignores non-clients even if their therapistId matches (corrupted data)', async () => {
    const weird = { ...andrii(), therapistId: SEED_IDS.therapistOlena };
    const repo = new InMemoryUserRepository([iryna(), weird]);
    const list = await repo.findClientsByTherapist(SEED_IDS.therapistOlena, PAGE);
    expect(list.map((u) => u.id)).toEqual([SEED_IDS.clientIryna]);
  });

  it('compareByNameThenId: Ukrainian alphabet, not code points (spec §4)', () => {
    const u = (name: string, i: number) => ({ ...iryna(), name, id: String(i) });
    const names = [
      'Ірина',
      'Євген',
      'Ґанна',
      'Андрій',
      'Йосип',
      'Богдан',
      'Ївга',
      'Гліб',
      'Иван',
      'Ігор',
    ];
    const sorted = names
      .map(u)
      .sort(compareByNameThenId)
      .map((x) => x.name);
    expect(sorted).toEqual([
      'Андрій',
      'Богдан',
      'Гліб',
      'Ґанна',
      'Євген',
      'Иван',
      'Ігор',
      'Ірина',
      'Ївга',
      'Йосип',
    ]);
  });

  it('compareByNameThenId: case-insensitive, equal names fall back to id', () => {
    const u = (name: string, id: string) => ({ ...iryna(), name, id });
    expect(compareByNameThenId(u('андрій', '2'), u('Андрій', '1'))).toBe(1);
    expect(compareByNameThenId(u('АНДРІЙ', '1'), u('андрій', '2'))).toBe(-1);
    expect(compareByNameThenId(u('андрій', '1'), u('Богдан', '0'))).toBeLessThan(0);
  });

  it('compareByNameThenId: name first, then id, equal → 0', () => {
    const u = (name: string, id: string) => ({ ...iryna(), name, id });
    expect(compareByNameThenId(u('A', '2'), u('B', '1'))).toBeLessThan(0);
    expect(compareByNameThenId(u('B', '1'), u('A', '2'))).toBeGreaterThan(0);
    expect(compareByNameThenId(u('A', '1'), u('A', '2'))).toBe(-1);
    expect(compareByNameThenId(u('A', '2'), u('A', '1'))).toBe(1);
    expect(compareByNameThenId(u('A', '1'), u('A', '1'))).toBe(0);
  });

  it('equal names are ordered by id', async () => {
    const a = { ...iryna(), id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'X' };
    const b = { ...iryna(), id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'X' };
    const repo = new InMemoryUserRepository([a, b]);
    const list = await repo.findClientsByTherapist(SEED_IDS.therapistOlena, PAGE);
    expect(list.map((u) => u.id)).toEqual([b.id, a.id]);
  });
});
