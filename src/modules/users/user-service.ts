import { NotFoundError, UnauthorizedError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { isUuid } from '../../lib/uuid.js';
import type { User, UserRepository } from './user.js';

export interface PublicProfile {
  id: string;
  name: string;
  contacts: string;
}

export class UserService {
  constructor(
    private readonly users: UserRepository,
    private readonly logger: Logger,
  ) {}

  /** spec §7: немає заголовка / не UUID / немає користувача → 401. */
  async authenticate(rawUserId: string | undefined): Promise<User> {
    if (rawUserId === undefined || rawUserId === '') {
      throw new UnauthorizedError('X-User-Id header is required');
    }
    if (!isUuid(rawUserId)) {
      throw new UnauthorizedError('X-User-Id must be a valid UUID');
    }
    const user = await this.users.findById(rawUserId);
    if (!user) {
      throw new UnauthorizedError('Unknown user');
    }
    return user;
  }

  async getTherapistOf(client: User): Promise<PublicProfile> {
    // spec: у клієнта therapist_id завжди є (CHECK у БД + тест seed).
    const therapist = client.therapistId ? await this.users.findById(client.therapistId) : null;
    if (!therapist) {
      this.logger.error({ clientId: client.id }, 'client has no therapist');
      throw new NotFoundError('Therapist not found');
    }
    return toProfile(therapist);
  }

  async listClientsOf(therapist: User): Promise<PublicProfile[]> {
    const clients = await this.users.findClientsByTherapist(therapist.id);
    return clients.map(toProfile);
  }

  /** Клієнт цього терапевта; чужий або неіснуючий → 404 (spec §7). */
  async getOwnClient(therapist: User, clientId: string): Promise<User> {
    const client = isUuid(clientId) ? await this.users.findById(clientId) : null;
    if (!client || client.role !== 'client' || client.therapistId !== therapist.id) {
      throw new NotFoundError('Client not found');
    }
    return client;
  }
}

function toProfile(user: User): PublicProfile {
  return { id: user.id, name: user.name, contacts: user.contacts };
}
