import type { Config } from './config.js';
import { createPool } from './db/pool.js';
import { PgEntryRepository } from './modules/entries/pg-entry-repository.js';
import { PgNoteRepository } from './modules/notes/pg-note-repository.js';
import { PgUserRepository } from './modules/users/pg-user-repository.js';
import { Container } from './lib/di/container.js';
import { createLogger } from './lib/logger.js';
import { EntryService } from './modules/entries/entry-service.js';
import { InMemoryEntryRepository } from './modules/entries/in-memory-entry-repository.js';
import { InMemoryNoteRepository } from './modules/notes/in-memory-note-repository.js';
import { NoteService } from './modules/notes/note-service.js';
import { InMemoryUserRepository } from './modules/users/in-memory-user-repository.js';
import { UserService } from './modules/users/user-service.js';
import { SEED_ENTRIES, SEED_NOTES, SEED_USERS } from './seed-data.js';
import { TOKENS } from './tokens.js';

/** Composition root: єдине місце, де вирішується, яка реалізація за яким ключем. */
export function buildContainer(config: Config): Container {
  const c = new Container();
  c.registerValue(TOKENS.config, config);
  c.register(TOKENS.logger, () => createLogger(config.LOG_LEVEL));

  if (config.STORAGE === 'postgres') {
    registerPostgresRepositories(c, config);
  } else {
    registerInMemoryRepositories(c);
  }

  c.register(
    TOKENS.userService,
    (c) => new UserService(c.resolve(TOKENS.userRepository), c.resolve(TOKENS.logger)),
  );
  c.register(
    TOKENS.entryService,
    (c) =>
      new EntryService(
        c.resolve(TOKENS.entryRepository),
        c.resolve(TOKENS.userService),
        c.resolve(TOKENS.logger),
      ),
  );
  c.register(
    TOKENS.noteService,
    (c) =>
      new NoteService(
        c.resolve(TOKENS.noteRepository),
        c.resolve(TOKENS.entryService),
        c.resolve(TOKENS.logger),
      ),
  );
  return c;
}

function registerPostgresRepositories(c: Container, config: Config): void {
  const url = config.DATABASE_URL;
  // loadConfig уже це перевіряє; захист на випадок конфігу, зібраного вручну.
  if (!url) throw new Error('DATABASE_URL is required when STORAGE=postgres');
  c.register(TOKENS.pool, () => createPool(url));
  c.register(TOKENS.userRepository, (c) => new PgUserRepository(c.resolve(TOKENS.pool)));
  c.register(TOKENS.entryRepository, (c) => new PgEntryRepository(c.resolve(TOKENS.pool)));
  c.register(TOKENS.noteRepository, (c) => new PgNoteRepository(c.resolve(TOKENS.pool)));
}

function registerInMemoryRepositories(c: Container): void {
  // Одне сховище записів і для EntryRepository, і для атомарної перевірки в нотатках.
  const entries = new InMemoryEntryRepository(SEED_ENTRIES);
  c.register(TOKENS.userRepository, () => new InMemoryUserRepository(SEED_USERS));
  c.registerValue(TOKENS.entryRepository, entries);
  c.register(TOKENS.noteRepository, () => new InMemoryNoteRepository(entries, SEED_NOTES));
}
