import { pino, type DestinationStream, type Logger } from 'pino';
import { getBusinessProcess } from './context.js';

export type { Logger };

/** `destination` — для тестів; за замовчуванням stdout. */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  return pino(
    {
      level,
      base: { service: 'cbt-journal' },
      // Кожен рядок логу автоматично отримує bpId (і userId, якщо відомий).
      mixin() {
        const bp = getBusinessProcess();
        return bp ? { bpId: bp.bpId, userId: bp.userId } : {};
      },
    },
    destination ?? pino.destination(1),
  );
}
