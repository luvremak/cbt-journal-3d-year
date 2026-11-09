import { z } from 'zod';
import { ValidationError } from './errors.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

export interface Page {
  limit: number;
  offset: number;
}

/** Ціле невід'ємне число з рядка query: "5.5", "-1", "abc", "" не проходять. */
const intParam = z.string().regex(/^\d+$/, 'must be a non-negative integer').transform(Number);

const schema = z.object({
  limit: intParam.pipe(z.number().min(1).max(MAX_LIMIT)).optional(),
  offset: intParam.optional(),
});

/** spec §4: limit 1–100 (за замовчуванням 50), offset ≥ 0 (0); інакше → 422. */
export function parsePage(query: Record<string, unknown>): Page {
  const result = schema.safeParse({ limit: query.limit, offset: query.offset });
  if (!result.success) {
    throw ValidationError.fromIssues('Invalid pagination parameters', result.error.issues);
  }
  return { limit: result.data.limit ?? DEFAULT_LIMIT, offset: result.data.offset ?? 0 };
}

/** Порядок spec §4: created_at від нових до старих, за однакового часу — за id. */
export function compareNewestFirst(
  a: { createdAt: Date; id: string },
  b: { createdAt: Date; id: string },
): number {
  return b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export function slicePage<T>(items: T[], page: Page): T[] {
  return items.slice(page.offset, page.offset + page.limit);
}
