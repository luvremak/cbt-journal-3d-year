import type { Pool } from '../../db/pool.js';

export interface BuildInfo {
  version: string;
  commit: string;
  environment: string;
  storage: 'memory' | 'postgres';
  startedAt: Date;
}

export interface Health {
  status: 'ok' | 'unavailable';
  database: 'ok' | 'unavailable' | 'not_used';
}

/**
 * Службові ендпоінти. /health — для балансувальника (Render не пускає трафік
 * на екземпляр, що не відповідає 200). /version — щоб бачити, що задеплоєно.
 */
export class SystemService {
  constructor(
    private readonly build: BuildInfo,
    private readonly db: Pool | null,
  ) {}

  async health(): Promise<Health> {
    if (!this.db) return { status: 'ok', database: 'not_used' };
    try {
      await this.db.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch {
      return { status: 'unavailable', database: 'unavailable' };
    }
  }

  async version() {
    return {
      version: this.build.version,
      commit: this.build.commit,
      environment: this.build.environment,
      storage: this.build.storage,
      started_at: this.build.startedAt.toISOString(),
      migration: await this.lastMigration(),
    };
  }

  /** Остання застосована міграція (null для memory або якщо БД недоступна). */
  private async lastMigration(): Promise<string | null> {
    const db = this.db;
    if (!db) return null;
    // Ловимо лише помилку запиту до БД, а не помилки в нашому коді.
    const rows = await db
      .query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1')
      .then(
        (result) => result.rows,
        // Stryker disable next-line ArrowFunction: еквівалентний — undefined і null далі дають null.
        () => null,
      );
    return rows?.[0]?.name ?? null;
  }
}
