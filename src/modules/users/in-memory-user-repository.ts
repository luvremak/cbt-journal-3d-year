import type { User, UserRepository } from './user.js';

export class InMemoryUserRepository implements UserRepository {
  private readonly users: Map<string, User>;

  constructor(seed: readonly User[]) {
    this.users = new Map(seed.map((u) => [u.id, { ...u }]));
  }

  async findById(id: string): Promise<User | null> {
    const user = this.users.get(id);
    return user ? { ...user } : null;
  }

  async findClientsByTherapist(therapistId: string): Promise<User[]> {
    return [...this.users.values()]
      .filter((u) => u.role === 'client' && u.therapistId === therapistId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => ({ ...u }));
  }
}
