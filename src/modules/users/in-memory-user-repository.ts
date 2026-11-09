import { slicePage, type Page } from '../../lib/pagination.js';
import type { User, UserRepository } from './user.js';

/** spec §4: українська абетка без урахування регістру (як колація `uk_ci` у PostgreSQL). */
const ukrainian = new Intl.Collator('uk', { sensitivity: 'accent' });

/** Той самий порядок, що `ORDER BY name COLLATE uk_ci, id` у PostgreSQL. */
export function compareByNameThenId(a: User, b: User): number {
  const byName = ukrainian.compare(a.name, b.name);
  if (byName !== 0) return byName;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export class InMemoryUserRepository implements UserRepository {
  private readonly users: Map<string, User>;

  constructor(seed: readonly User[]) {
    this.users = new Map(seed.map((u) => [u.id, { ...u }]));
  }

  async findById(id: string): Promise<User | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async findClientsByTherapist(therapistId: string, page: Page): Promise<User[]> {
    const clients = [...this.users.values()]
      .filter((u) => u.role === 'client' && u.therapistId === therapistId)
      .sort(compareByNameThenId);
    return slicePage(clients, page).map((u) => ({ ...u }));
  }
}
