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
    /** Назва оточення для /version: local, ci, staging. */
    APP_ENV: z.string().min(1).default('local'),
    /** Кеш користувачів у пам'яті (perf): TTL у мс, 0 — вимкнено. */
    USER_CACHE_TTL_MS: z.coerce.number().int().min(0).default(60_000),
    USER_CACHE_MAX: z.coerce.number().int().positive().default(10_000),
    /** Коміт збірки для /version; на Render береться з RENDER_GIT_COMMIT. */
    GIT_COMMIT: z.string().min(1).default('unknown'),
  })
  .refine((c) => c.STORAGE !== 'postgres' || Boolean(c.DATABASE_URL), {
    message: 'DATABASE_URL is required when STORAGE=postgres',
    path: ['DATABASE_URL'],
  });

export type Config = z.output<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse({ ...env, GIT_COMMIT: env.GIT_COMMIT || env.RENDER_GIT_COMMIT || undefined });
}
