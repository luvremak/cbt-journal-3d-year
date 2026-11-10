import { describe, expect, it, vi } from 'vitest';
import { CachingUserRepository } from '../../src/modules/users/caching-user-repository.js';
import { InMemoryUserRepository } from '../../src/modules/users/in-memory-user-repository.js';
import { SEED_IDS, SEED_USERS } from '../../src/seed-data.js';
import { PAGE } from '../helpers/fakes.js';

const UNKNOWN = '99999999-9999-4999-8999-999999999999';

function setup(options: { ttlMs?: number; maxEntries?: number } = {}) {
  const inner = new InMemoryUserRepository(SEED_USERS);
  const findById = vi.spyOn(inner, 'findById');
  let now = 1_000;
  const repo = new CachingUserRepository(inner, {
    ttlMs: options.ttlMs ?? 100,
    maxEntries: options.maxEntries ?? 10,
    now: () => now,
  });
  return { repo, inner, findById, advance: (ms: number) => (now += ms) };
}

describe('CachingUserRepository (perf: no DB round trip for X-User-Id)', () => {
  it('second lookup within TTL is served from the cache', async () => {
    const { repo, findById } = setup();
    const a = await repo.findById(SEED_IDS.clientIryna);
    const b = await repo.findById(SEED_IDS.clientIryna);
    expect(b).toEqual(a);
    expect(findById).toHaveBeenCalledTimes(1);
  });

  it('expires after TTL (strictly: at exactly TTL it is stale)', async () => {
    const { repo, findById, advance } = setup({ ttlMs: 100 });
    await repo.findById(SEED_IDS.clientIryna);
    advance(99);
    await repo.findById(SEED_IDS.clientIryna);
    expect(findById).toHaveBeenCalledTimes(1);
    advance(1);
    await repo.findById(SEED_IDS.clientIryna);
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it('does not cache missing users (new seed is visible at once)', async () => {
    const { repo, findById } = setup();
    expect(await repo.findById(UNKNOWN)).toBeNull();
    expect(await repo.findById(UNKNOWN)).toBeNull();
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest entry when full', async () => {
    const { repo, findById } = setup({ maxEntries: 2 });
    await repo.findById(SEED_IDS.clientIryna);
    await repo.findById(SEED_IDS.clientMaksym);
    await repo.findById(SEED_IDS.clientSofiia); // витісняє Ірину
    findById.mockClear();
    await repo.findById(SEED_IDS.clientMaksym);
    await repo.findById(SEED_IDS.clientSofiia);
    expect(findById).not.toHaveBeenCalled();
    await repo.findById(SEED_IDS.clientIryna);
    expect(findById).toHaveBeenCalledTimes(1);
  });

  it('a refreshed expired entry does not evict others', async () => {
    const { repo, findById, advance } = setup({ maxEntries: 2, ttlMs: 100 });
    await repo.findById(SEED_IDS.clientIryna);
    advance(50);
    await repo.findById(SEED_IDS.clientMaksym);
    advance(60); // Ірина прострочена, Максим ще ні
    await repo.findById(SEED_IDS.clientIryna);
    findById.mockClear();
    await repo.findById(SEED_IDS.clientMaksym);
    expect(findById).not.toHaveBeenCalled();
  });

  it('a refreshed entry becomes the newest (evicted after older ones)', async () => {
    const { repo, findById, advance } = setup({ maxEntries: 3, ttlMs: 100 });
    await repo.findById(SEED_IDS.clientIryna); // t=1000
    advance(50);
    await repo.findById(SEED_IDS.clientMaksym); // t=1050
    advance(60);
    await repo.findById(SEED_IDS.clientIryna); // прострочена → оновлена, тепер найновіша
    await repo.findById(SEED_IDS.clientSofiia);
    await repo.findById(SEED_IDS.therapistOlena); // витісняє найстарішого — Максима
    findById.mockClear();
    await repo.findById(SEED_IDS.clientIryna);
    expect(findById).not.toHaveBeenCalled();
    await repo.findById(SEED_IDS.clientMaksym);
    expect(findById).toHaveBeenCalledTimes(1);
  });

  it('returns copies: callers cannot change cached data', async () => {
    const { repo } = setup();
    const first = await repo.findById(SEED_IDS.clientIryna);
    if (first) first.name = 'змінено';
    const cached = await repo.findById(SEED_IDS.clientIryna);
    if (cached) cached.name = 'ще раз';
    expect((await repo.findById(SEED_IDS.clientIryna))?.name).toBe('Ірина');
  });

  it('client lists are never cached', async () => {
    const { repo, inner } = setup();
    const list = vi.spyOn(inner, 'findClientsByTherapist');
    await repo.findClientsByTherapist(SEED_IDS.therapistOlena, PAGE);
    const result = await repo.findClientsByTherapist(SEED_IDS.therapistOlena, PAGE);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith(SEED_IDS.therapistOlena, PAGE);
    expect(result.map((u) => u.name)).toEqual(['Ірина', 'Максим']);
  });

  it('uses Date.now by default', async () => {
    const inner = new InMemoryUserRepository(SEED_USERS);
    const findById = vi.spyOn(inner, 'findById');
    const repo = new CachingUserRepository(inner, { ttlMs: 60_000, maxEntries: 10 });
    await repo.findById(SEED_IDS.clientIryna);
    await repo.findById(SEED_IDS.clientIryna);
    expect(findById).toHaveBeenCalledTimes(1);
  });
});
