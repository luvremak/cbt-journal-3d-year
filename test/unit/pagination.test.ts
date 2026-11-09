import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/lib/errors.js';
import {
  compareNewestFirst,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePage,
  slicePage,
} from '../../src/lib/pagination.js';

describe('parsePage (spec §4 pagination)', () => {
  it('defaults: limit 50, offset 0', () => {
    expect(parsePage({})).toEqual({ limit: 50, offset: 0 });
    expect(DEFAULT_LIMIT).toBe(50);
    expect(MAX_LIMIT).toBe(100);
  });

  it.each([
    [{ limit: '1' }, { limit: 1, offset: 0 }],
    [{ limit: '100' }, { limit: 100, offset: 0 }],
    [{ offset: '0' }, { limit: 50, offset: 0 }],
    [
      { limit: '10', offset: '30' },
      { limit: 10, offset: 30 },
    ],
  ])('accepts %o', (query, expected) => {
    expect(parsePage(query)).toEqual(expected);
  });

  it.each([
    { limit: '0' },
    { limit: '101' },
    { limit: '5.5' },
    { limit: 'abc' },
    { limit: '' },
    { limit: '-1' },
    { offset: '-1' },
    { offset: '1.5' },
    { offset: 'x' },
    { limit: ['1', '2'] },
  ])('rejects %o with 422', (query) => {
    expect(() => parsePage(query)).toThrow(ValidationError);
  });

  it('reports which field is invalid', () => {
    try {
      parsePage({ offset: '-1' });
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).status).toBe(422);
      expect((error as ValidationError).message).toBe('Invalid pagination parameters');
      expect((error as ValidationError).details).toEqual([
        { field: 'offset', message: 'must be a non-negative integer' },
      ]);
    }
  });
});

describe('compareNewestFirst', () => {
  const at = (iso: string, id: string) => ({ createdAt: new Date(iso), id });

  it('newer first', () => {
    const items = [at('2026-01-01', 'a'), at('2026-01-03', 'b'), at('2026-01-02', 'c')];
    expect(items.sort(compareNewestFirst).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('equal time: higher id first (same as ORDER BY id DESC)', () => {
    const items = [at('2026-01-01', 'a'), at('2026-01-01', 'c'), at('2026-01-01', 'b')];
    expect(items.sort(compareNewestFirst).map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('direct comparisons for equal time', () => {
    expect(compareNewestFirst(at('2026-01-01', 'a'), at('2026-01-01', 'b'))).toBe(1);
    expect(compareNewestFirst(at('2026-01-01', 'b'), at('2026-01-01', 'a'))).toBe(-1);
  });

  it('identical items compare equal', () => {
    expect(compareNewestFirst(at('2026-01-01', 'a'), at('2026-01-01', 'a'))).toBe(0);
  });
});

describe('slicePage', () => {
  const items = [1, 2, 3, 4, 5];
  it('slices by offset and limit', () => {
    expect(slicePage(items, { limit: 2, offset: 0 })).toEqual([1, 2]);
    expect(slicePage(items, { limit: 2, offset: 2 })).toEqual([3, 4]);
    expect(slicePage(items, { limit: 2, offset: 4 })).toEqual([5]);
    expect(slicePage(items, { limit: 2, offset: 10 })).toEqual([]);
  });
});
