import type { Page } from '../../lib/pagination.js';
import type { User, UserRepository } from './user.js';

export interface UserCacheOptions {
  /** Скільки мілісекунд запис кешу вважається свіжим. */
  ttlMs: number;
  /** Максимум записів; найстаріший витісняється першим. */
  maxEntries: number;
  /** Годинник (для тестів). */
  now?: () => number;
}

/**
 * Декоратор UserRepository: кешує findById у пам'яті процесу.
 * Користувачі з'являються лише через seed і через API не змінюються (spec §7),
 * тому застарілість обмежена TTL. Відсутніх користувачів не кешуємо: новий seed
 * стає видимим одразу. Списки (findClientsByTherapist) не кешуються.
 */
export class CachingUserRepository implements UserRepository {
  private readonly cache = new Map<string, { user: User; expiresAt: number }>();
  private readonly now: () => number;

  constructor(
    private readonly inner: UserRepository,
    private readonly options: UserCacheOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async findById(id: string): Promise<User | null> {
    const hit = this.cache.get(id);
    if (hit && hit.expiresAt > this.now()) {
      return { ...hit.user };
    }
    this.cache.delete(id);
    const user = await this.inner.findById(id);
    if (user) {
      if (this.cache.size >= this.options.maxEntries) {
        // Map зберігає порядок вставки: перший ключ — найстаріший.
        for (const oldest of this.cache.keys()) {
          this.cache.delete(oldest);
          break;
        }
      }
      this.cache.set(id, { user: { ...user }, expiresAt: this.now() + this.options.ttlMs });
    }
    return user;
  }

  findClientsByTherapist(therapistId: string, page: Page): Promise<User[]> {
    return this.inner.findClientsByTherapist(therapistId, page);
  }
}
