import { Writable } from 'node:stream';
import { pino } from 'pino';
import { createLogger } from '../../src/lib/logger.js';
import { InMemoryEntryRepository } from '../../src/modules/entries/in-memory-entry-repository.js';
import { EntryService } from '../../src/modules/entries/entry-service.js';
import { InMemoryNoteRepository } from '../../src/modules/notes/in-memory-note-repository.js';
import { NoteService } from '../../src/modules/notes/note-service.js';
import { InMemoryUserRepository } from '../../src/modules/users/in-memory-user-repository.js';
import type { User } from '../../src/modules/users/user.js';
import { UserService } from '../../src/modules/users/user-service.js';
import { SEED_ENTRIES, SEED_IDS, SEED_NOTES, SEED_USERS } from '../../src/seed-data.js';

export const silentLogger = pino({ level: 'silent' });

export type LogLine = Record<string, unknown>;

/** Справжній логер застосунку (createLogger), що пише рядки JSON у масив. */
export function captureLogger(level = 'debug') {
  const logs: LogLine[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        logs.push(JSON.parse(line) as LogLine);
      }
      cb();
    },
  });
  return { logger: createLogger(level, sink), logs };
}

export function seedUser(id: string): User {
  const user = SEED_USERS.find((u) => u.id === id);
  if (!user) throw new Error(`no seed user ${id}`);
  return { ...user };
}

export const olena = () => seedUser(SEED_IDS.therapistOlena);
export const andrii = () => seedUser(SEED_IDS.therapistAndrii);
export const iryna = () => seedUser(SEED_IDS.clientIryna);
export const maksym = () => seedUser(SEED_IDS.clientMaksym);
export const sofiia = () => seedUser(SEED_IDS.clientSofiia);

/** Сервіси на in-memory репозиторіях із seed-даними — для unit-тестів. */
export function createServices() {
  const userRepo = new InMemoryUserRepository(SEED_USERS);
  const entryRepo = new InMemoryEntryRepository(SEED_ENTRIES);
  const noteRepo = new InMemoryNoteRepository(entryRepo, SEED_NOTES);
  const { logger, logs } = captureLogger();
  const users = new UserService(userRepo, logger);
  const entries = new EntryService(entryRepo, users, logger);
  const notes = new NoteService(noteRepo, entries, logger);
  return { userRepo, entryRepo, noteRepo, users, entries, notes, logger, logs };
}

export const PAGE = { limit: 50, offset: 0 };

export const validEntry = {
  situation: 'Ситуація',
  thought: 'Думка',
  emotion: 'тривога',
  emotionIntensity: 40,
  rationalResponse: null,
};
