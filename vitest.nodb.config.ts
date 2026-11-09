import { defineConfig } from 'vitest/config';

/**
 * Явний режим без PostgreSQL: unit-тести, контракт і E2E лише для in-memory.
 * Використовують `npm run test:nodb`, `npm run test:unit` і Stryker (`make mutation`).
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: { LOG_LEVEL: 'silent', TEST_DATABASE_URL: '' },
  },
});
