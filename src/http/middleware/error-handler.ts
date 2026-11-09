import type { ErrorRequestHandler, RequestHandler } from 'express';
import { getBusinessProcess } from '../../lib/context.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';

interface BodyParserError {
  type?: string;
  status?: number;
}

/** Невідомий маршрут → 404 у тому ж форматі, що й інші помилки. */
export const notFoundHandler: RequestHandler = (req) => {
  throw new NotFoundError(`Route ${req.method} ${req.path} not found`);
};

/**
 * Глобальний обробник: єдиний формат відповіді
 * `{ error: { code, message, details? }, bp_id }`.
 * Деталі внутрішніх помилок (500) клієнт не бачить — лише лог.
 */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    const bpId = getBusinessProcess()?.bpId ?? res.getHeader('X-Business-Process-Id');
    const send = (status: number, code: string, message: string, details?: unknown) => {
      res.status(status).json({
        // details: undefined у JSON не потрапляє.
        error: { code, message, details },
        bp_id: bpId,
      });
    };

    if (err instanceof AppError) {
      logger.info({ status: err.status, code: err.code, reason: err.message }, 'request rejected');
      send(err.status, err.code, err.message, err.details);
      return;
    }

    const parserError = err as BodyParserError;
    if (parserError.type === 'entity.parse.failed') {
      send(400, 'BAD_REQUEST', 'Malformed JSON body');
      return;
    }
    if (parserError.type === 'entity.too.large') {
      send(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
      return;
    }

    logger.error({ err }, 'unhandled error');
    send(500, 'INTERNAL_ERROR', 'Internal server error');
  };
}
