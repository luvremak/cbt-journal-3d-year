import type { Pool } from '../../db/pool.js';
import type { Page } from '../../lib/pagination.js';
import type { Role, User, UserRepository } from './user.js';

interface UserRow {
  id: string;
  role: Role;
  name: string;
  contacts: string;
  therapist_id: string | null;
}

const COLUMNS = 'id, role, name, contacts, therapist_id';

export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [
      id,
    ]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findClientsByTherapist(therapistId: string, page: Page): Promise<User[]> {
    const { rows } = await this.pool.query<UserRow>(
      `SELECT ${COLUMNS} FROM users
       WHERE role = 'client' AND therapist_id = $1
       ORDER BY name COLLATE "C", id
       LIMIT $2 OFFSET $3`,
      [therapistId, page.limit, page.offset],
    );
    return rows.map(toUser);
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    contacts: row.contacts,
    therapistId: row.therapist_id,
  };
}
