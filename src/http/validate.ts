import type { z } from 'zod';
import { ValidationError } from '../lib/errors.js';

/** Порушення правил валідації → 422 (spec §4). */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new ValidationError(
      'Request body is invalid',
      result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
