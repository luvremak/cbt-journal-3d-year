import { defineConfig } from 'vitest/config';

/** Тестова БД: та сама, що в docker-compose, окрема база cbt_test. */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://cbt:cbt@localhost:5432/cbt_test';
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;

/**
 * Повний прогін: unit + інтеграційні + E2E на PostgreSQL. База обов'язкова
 * (standards/testing.md): без неї globalSetup падає, а не пропускає тести мовчки.
 * Без БД — лише явно: `npm run test:nodb` (vitest.nodb.config.ts).
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/helpers/global-setup.ts'],
    // Інтеграційні й E2E-тести ділять одну тестову БД — файли по черзі.
    fileParallelism: false,
    env: { LOG_LEVEL: 'silent', TEST_DATABASE_URL },
    coverage: {
      provider: 'v8',
      // Підсумок для звіту якості (scripts/quality-report.mjs) і текст у консоль.
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'reports/coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
