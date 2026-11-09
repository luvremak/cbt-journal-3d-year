import { describe, expect, it } from 'vitest';
import type { Entry } from '../../src/modules/entries/entry.js';
import {
  createEntryBody,
  toEntryDto,
  toTherapistEntryDto,
} from '../../src/modules/entries/entry-schemas.js';
import { createNoteBody, toNoteDto } from '../../src/modules/notes/note-schemas.js';

const valid = { situation: 'S', thought: 'T', emotion: 'E', emotion_intensity: 50 };
const ok = (body: unknown) => createEntryBody.safeParse(body).success;

describe('createEntryBody (spec §4 validation)', () => {
  it('maps snake_case body to domain input', () => {
    expect(createEntryBody.parse({ ...valid, rational_response: 'R' })).toEqual({
      situation: 'S',
      thought: 'T',
      emotion: 'E',
      emotionIntensity: 50,
      rationalResponse: 'R',
    });
  });

  it('trims required text', () => {
    const r = createEntryBody.parse({
      ...valid,
      situation: '  S  ',
      thought: '\tT\n',
      emotion: ' E ',
    });
    expect([r.situation, r.thought, r.emotion]).toEqual(['S', 'T', 'E']);
  });

  it.each(['situation', 'thought', 'emotion'] as const)('%s is required, non-blank', (field) => {
    const { [field]: _, ...without } = valid;
    expect(ok(without)).toBe(false);
    expect(ok({ ...valid, [field]: '' })).toBe(false);
    expect(ok({ ...valid, [field]: '   ' })).toBe(false);
    expect(ok({ ...valid, [field]: null })).toBe(false);
    expect(ok({ ...valid, [field]: 5 })).toBe(false);
  });

  it('emotion max 100 chars; situation/thought/rational_response max 5000', () => {
    expect(ok({ ...valid, emotion: 'a'.repeat(100) })).toBe(true);
    expect(ok({ ...valid, emotion: 'a'.repeat(101) })).toBe(false);
    for (const f of ['situation', 'thought', 'rational_response']) {
      expect(ok({ ...valid, [f]: 'a'.repeat(5000) })).toBe(true);
      expect(ok({ ...valid, [f]: 'a'.repeat(5001) })).toBe(false);
    }
  });

  it('length is measured after trim', () => {
    expect(ok({ ...valid, emotion: ` ${'a'.repeat(100)} ` })).toBe(true);
  });

  it.each([0, 1, 99, 100])('intensity %i is accepted', (n) => {
    expect(ok({ ...valid, emotion_intensity: n })).toBe(true);
  });

  it.each([-1, 101, 10.5, '10', null, undefined, Number.NaN])('intensity %o is rejected', (n) => {
    expect(ok({ ...valid, emotion_intensity: n })).toBe(false);
  });

  it.each([undefined, null, '', '   '])('rational_response %o is stored as null', (v) => {
    expect(createEntryBody.parse({ ...valid, rational_response: v }).rationalResponse).toBeNull();
  });

  it('rational_response is trimmed', () => {
    expect(createEntryBody.parse({ ...valid, rational_response: '  R ' }).rationalResponse).toBe(
      'R',
    );
  });

  it('rational_response of wrong type is rejected', () => {
    expect(ok({ ...valid, rational_response: 5 })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(ok(null)).toBe(false);
    expect(ok('x')).toBe(false);
  });
});

const entry: Entry = {
  id: 'e1',
  clientId: 'c1',
  situation: 'S',
  thought: 'T',
  emotion: 'E',
  emotionIntensity: 50,
  rationalResponse: null,
  createdAt: new Date('2026-11-01T10:00:00Z'),
  deletedAt: null,
};

describe('entry DTOs', () => {
  it('client DTO uses spec field names and hides clientId/deletedAt', () => {
    expect(toEntryDto(entry)).toEqual({
      id: 'e1',
      situation: 'S',
      thought: 'T',
      emotion: 'E',
      emotion_intensity: 50,
      rational_response: null,
      created_at: '2026-11-01T10:00:00.000Z',
    });
  });

  it('therapist DTO of an active entry has content and deleted=false', () => {
    expect(toTherapistEntryDto(entry)).toEqual({ ...toEntryDto(entry), deleted: false });
  });

  it('therapist DTO of a deleted entry has ONLY id, dates and deleted=true (spec §4)', () => {
    const deleted = { ...entry, deletedAt: new Date('2026-11-02T10:00:00Z') };
    expect(toTherapistEntryDto(deleted)).toStrictEqual({
      id: 'e1',
      deleted: true,
      created_at: '2026-11-01T10:00:00.000Z',
      deleted_at: '2026-11-02T10:00:00.000Z',
    });
  });
});

describe('note schema and DTO', () => {
  it('text is required, trimmed, 1..5000', () => {
    expect(createNoteBody.parse({ text: '  hi ' })).toEqual({ text: 'hi' });
    expect(createNoteBody.safeParse({ text: '   ' }).success).toBe(false);
    expect(createNoteBody.safeParse({}).success).toBe(false);
    expect(createNoteBody.safeParse({ text: 'a'.repeat(5000) }).success).toBe(true);
    expect(createNoteBody.safeParse({ text: 'a'.repeat(5001) }).success).toBe(false);
  });

  it('DTO', () => {
    expect(
      toNoteDto({
        id: 'n1',
        entryId: 'e1',
        therapistId: 't1',
        text: 'x',
        createdAt: new Date('2026-11-01T10:00:00Z'),
      }),
    ).toEqual({ id: 'n1', entry_id: 'e1', text: 'x', created_at: '2026-11-01T10:00:00.000Z' });
  });
});
