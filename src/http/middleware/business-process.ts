import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { runInBusinessProcess } from '../../lib/context.js';
import type { Logger } from '../../lib/logger.js';
import { isUuid } from '../../lib/uuid.js';

export const BP_HEADER = 'X-Business-Process-Id';

/**
 * Відкриває бізнес-процес на кожен запит. ID береться із заголовка
 * (щоб зовнішній виклик можна було зв'язати з нашими логами) або генерується.
 * ID повертається в заголовку відповіді й потрапляє в усі логи процесу.
 */
export function businessProcess(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header(BP_HEADER);
    const bpId = isUuid(incoming) ? incoming : randomUUID();
    const startedAt = process.hrtime.bigint();

    res.setHeader(BP_HEADER, bpId);
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info(
        { bpId, method: req.method, path: req.originalUrl, status: res.statusCode, durationMs },
        'request finished',
      );
    });

    runInBusinessProcess({ bpId }, () => {
      logger.debug({ method: req.method, path: req.originalUrl }, 'request started');
      next();
    });
  };
}
