import { Writable } from 'node:stream';
import type { Express } from 'express';
import { loadConfig } from '../../src/config.js';
import { buildContainer } from '../../src/container.js';
import { createApp } from '../../src/http/app.js';
import { createLogger } from '../../src/lib/logger.js';
import type { Container } from '../../src/lib/di/container.js';
import { TOKENS } from '../../src/tokens.js';
import { TEST_DATABASE_URL } from './db.js';

export type Storage = 'memory' | 'postgres';

export interface TestApp {
  app: Express;
  container: Container;
  logs: Record<string, unknown>[];
  close(): Promise<void>;
}

/**
 * Збирає застосунок так само, як src/index.ts, але з логером, що пише в масив.
 * `override` дає змогу підмінити залежність у DI до створення застосунку.
 */
export function createTestApp(
  storage: Storage = 'memory',
  override?: (container: Container) => void,
): TestApp {
  const config = loadConfig({
    STORAGE: storage,
    DATABASE_URL: storage === 'postgres' ? TEST_DATABASE_URL : undefined,
    LOG_LEVEL: 'debug',
  });
  const container = buildContainer(config);

  const logs: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        logs.push(JSON.parse(line) as Record<string, unknown>);
      }
      cb();
    },
  });
  container.register(TOKENS.logger, () => createLogger('debug', sink));
  override?.(container);

  const app = createApp(container);
  return {
    app,
    container,
    logs,
    async close() {
      if (container.has(TOKENS.pool)) await container.resolve(TOKENS.pool).end();
    },
  };
}
