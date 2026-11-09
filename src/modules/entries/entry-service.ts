import { NotFoundError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { Page } from '../../lib/pagination.js';
import { isUuid } from '../../lib/uuid.js';
import type { User } from '../users/user.js';
import type { UserService } from '../users/user-service.js';
import type { Entry, EntryRepository } from './entry.js';
import type { CreateEntryInput } from './entry-schemas.js';

export class EntryService {
  constructor(
    private readonly entries: EntryRepository,
    private readonly users: UserService,
    private readonly logger: Logger,
  ) {}

  async create(client: User, input: CreateEntryInput): Promise<Entry> {
    const entry = await this.entries.create({ clientId: client.id, ...input });
    this.logger.info({ entryId: entry.id }, 'entry created');
    return entry;
  }

  /** Лише активні записи клієнта (spec §4, soft delete). */
  async listForClient(client: User, page: Page): Promise<Entry[]> {
    return this.entries.findByClient(client.id, { includeDeleted: false, page });
  }

  /** Власний активний запис; чужий, видалений або неіснуючий → 404. */
  async getForClient(client: User, entryId: string): Promise<Entry> {
    const entry = await this.findById(entryId);
    if (!entry || entry.clientId !== client.id || entry.deletedAt !== null) {
      throw new NotFoundError('Entry not found');
    }
    return entry;
  }

  /** spec §7: чужий або вже видалений запис → 404. */
  async deleteForClient(client: User, entryId: string): Promise<void> {
    const entry = await this.getForClient(client, entryId);
    const deleted = await this.entries.softDelete(entry.id);
    if (!deleted) {
      // Паралельний запит встиг видалити раніше.
      throw new NotFoundError('Entry not found');
    }
    this.logger.info({ entryId: entry.id }, 'entry soft-deleted');
  }

  /** Усі записи клієнта терапевта, включно з видаленими (їх ховає шар відповіді). */
  async listForTherapist(therapist: User, clientId: string, page: Page): Promise<Entry[]> {
    const client = await this.users.getOwnClient(therapist, clientId);
    return this.entries.findByClient(client.id, { includeDeleted: true, page });
  }

  /** Запис клієнта цього терапевта (активний чи видалений); інакше → 404. */
  async getForTherapist(therapist: User, entryId: string): Promise<Entry> {
    const entry = await this.findById(entryId);
    if (!entry) {
      throw new NotFoundError('Entry not found');
    }
    try {
      await this.users.getOwnClient(therapist, entry.clientId);
    } catch (error) {
      if (error instanceof NotFoundError) throw new NotFoundError('Entry not found');
      throw error;
    }
    return entry;
  }

  private async findById(entryId: string): Promise<Entry | null> {
    // Не-UUID не може існувати в БД; так ми не отримаємо 500 від PostgreSQL.
    return isUuid(entryId) ? this.entries.findById(entryId) : null;
  }
}
