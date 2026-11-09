import type { z } from 'zod';
import { ValidationError } from '../lib/errors.js';

/** Порушення правил валідації → 422 (spec §4). */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw ValidationError.fromIssues('Request body is invalid', result.error.issues);
  }
  return result.data;
}
