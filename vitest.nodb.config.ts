import { defineConfig } from 'vitest/config';

/**
 * Явний режим без PostgreSQL: unit-тести, контракт і E2E лише для in-memory.
 * Використовують `npm run test:nodb`, `npm run test:unit` і Stryker (`make mutation`).
 */
export default defineConfig({
  // Тести застосунку беруть бібліотеку з вихідного коду (як і typecheck через paths).
  resolve: {
    alias: { '@cbt-journal/di': new URL('./packages/di/src/index.ts', import.meta.url).pathname },
  },
  test: {
    include: ['test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    env: { LOG_LEVEL: 'silent', TEST_DATABASE_URL: '' },
  },
});
