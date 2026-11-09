import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Створює тестову БД і застосовує міграції, якщо задано TEST_DATABASE_URL.
    globalSetup: ['test/helpers/global-setup.ts'],
    // Інтеграційні й E2E-тести ділять одну тестову БД — файли по черзі.
    fileParallelism: false,
    env: { LOG_LEVEL: 'silent' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
  },
});
