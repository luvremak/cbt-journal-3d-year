import type { Page } from '../../lib/pagination.js';

export type Role = 'client' | 'therapist';

export interface User {
  id: string;
  role: Role;
  name: string;
  contacts: string;
  /** Для клієнта — його терапевт; для терапевта — null. */
  therapistId: string | null;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  /** Клієнти терапевта, відсортовані за ім'ям (за однакового — за id). */
  findClientsByTherapist(therapistId: string, page: Page): Promise<User[]>;
}
