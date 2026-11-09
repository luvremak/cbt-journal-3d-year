import { z } from 'zod';
import type { Entry } from './entry.js';

const MAX_TEXT = 5000;
const MAX_EMOTION = 100;

const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** spec §4: відсутнє, null, "" або пробіли → NULL. */
const optionalText = z.preprocess(
  (value) => (value === undefined ? null : value),
  z
    .string()
    .trim()
    .max(MAX_TEXT)
    .nullable()
    .transform((v) => (v === '' ? null : v)),
);

/** Тіло POST /client/entries — назви полів як у spec. */
export const createEntryBody = z
  .object({
    situation: requiredText(MAX_TEXT),
    thought: requiredText(MAX_TEXT),
    emotion: requiredText(MAX_EMOTION),
    emotion_intensity: z.number().int().min(0).max(100),
    rational_response: optionalText,
  })
  .transform((b) => ({
    situation: b.situation,
    thought: b.thought,
    emotion: b.emotion,
    emotionIntensity: b.emotion_intensity,
    rationalResponse: b.rational_response,
  }));

export type CreateEntryInput = z.output<typeof createEntryBody>;

export function toEntryDto(entry: Entry) {
  return {
    id: entry.id,
    situation: entry.situation,
    thought: entry.thought,
    emotion: entry.emotion,
    emotion_intensity: entry.emotionIntensity,
    rational_response: entry.rationalResponse,
    created_at: entry.createdAt.toISOString(),
  };
}

/** Вигляд для терапевта: видалений запис — лише id, created_at, deleted_at (spec §4). */
export function toTherapistEntryDto(entry: Entry) {
  if (entry.deletedAt !== null) {
    return {
      id: entry.id,
      deleted: true as const,
      created_at: entry.createdAt.toISOString(),
      deleted_at: entry.deletedAt.toISOString(),
    };
  }
  return { ...toEntryDto(entry), deleted: false as const };
}
