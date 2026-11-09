import { z } from 'zod';

const schema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    /** memory — статичні дані в пам'яті; postgres — PostgreSQL за DATABASE_URL. */
    STORAGE: z.enum(['memory', 'postgres']).default('memory'),
    DATABASE_URL: z.string().optional(),
  })
  .refine((c) => c.STORAGE !== 'postgres' || Boolean(c.DATABASE_URL), {
    message: 'DATABASE_URL is required when STORAGE=postgres',
    path: ['DATABASE_URL'],
  });

export type Config = z.output<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}
