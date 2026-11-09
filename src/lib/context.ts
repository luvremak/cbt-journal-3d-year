import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Контекст бізнес-процесу. Один HTTP-запит = один бізнес-процес
 * (наприклад, «клієнт створює запис»). Його ID потрапляє в кожен рядок логу,
 * тож усі логи одного процесу можна знайти за `bpId`.
 */
export interface BusinessProcessContext {
  bpId: string;
  userId?: string;
}

const storage = new AsyncLocalStorage<BusinessProcessContext>();

export function runInBusinessProcess<T>(context: BusinessProcessContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getBusinessProcess(): BusinessProcessContext | undefined {
  return storage.getStore();
}
