import type { Config } from './config.js';
import type { Pool } from './db/pool.js';
import { createToken } from './lib/di/container.js';
import type { Logger } from './lib/logger.js';
import type { EntryRepository } from './modules/entries/entry.js';
import type { SystemService } from './modules/system/system-service.js';
import type { EntryService } from './modules/entries/entry-service.js';
import type { NoteRepository } from './modules/notes/note.js';
import type { NoteService } from './modules/notes/note-service.js';
import type { UserRepository } from './modules/users/user.js';
import type { UserService } from './modules/users/user-service.js';

/** Ключі залежностей застосунку. */
export const TOKENS = {
  config: createToken<Config>('config'),
  logger: createToken<Logger>('logger'),
  pool: createToken<Pool>('pool'),
  userRepository: createToken<UserRepository>('userRepository'),
  entryRepository: createToken<EntryRepository>('entryRepository'),
  noteRepository: createToken<NoteRepository>('noteRepository'),
  userService: createToken<UserService>('userService'),
  entryService: createToken<EntryService>('entryService'),
  noteService: createToken<NoteService>('noteService'),
  systemService: createToken<SystemService>('systemService'),
};
