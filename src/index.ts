import { loadConfig } from './config.js';
import { buildContainer } from './container.js';
import { createApp } from './http/app.js';
import { TOKENS } from './tokens.js';

const config = loadConfig();
const container = buildContainer(config);
const logger = container.resolve(TOKENS.logger);
const app = createApp(container);

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, storage: config.STORAGE }, 'server started');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      if (container.has(TOKENS.pool)) await container.resolve(TOKENS.pool).end();
      process.exit(0);
    });
  });
}
