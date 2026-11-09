import { pino, type Logger } from 'pino';
import { getBusinessProcess } from './context.js';

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'cbt-journal' },
    // Кожен рядок логу автоматично отримує bpId (і userId, якщо відомий).
    mixin() {
      const bp = getBusinessProcess();
      return bp ? { bpId: bp.bpId, userId: bp.userId } : {};
    },
  });
}
