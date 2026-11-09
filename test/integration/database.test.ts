/**
 * Схема БД, міграції, seed і атомарність нотаток на справжньому PostgreSQL.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../src/db/migrate.js';
import type { Pool } from '../../src/db/pool.js';
import { findClientsWithInvalidTherapist, seed } from '../../src/db/seed.js';
import { PgNoteRepository } from '../../src/modules/notes/pg-note-repository.js';
import { SEED_IDS, SEED_USERS } from '../../src/seed-data.js';
import { createTestPool, hasDb, resetDb } from '../helpers/db.js';

describe.skipIf(!hasDb)('PostgreSQL integration', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = createTestPool();
  });
  afterAll(async () => {
    await pool.end();
  });
  beforeEach(async () => {
    await resetDb(pool);
  });

  describe('seed (spec §4, §7)', () => {
    it('every client therapist_id points to a therapist', async () => {
      expect(await findClientsWithInvalidTherapist(pool)).toEqual([]);
    });

    it('the integrity check catches a client pointing to another client', async () => {
      // CHECK у БД це пропускає (роль client, therapist_id не NULL) — ловить лише перевірка.
      const bad = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      await pool.query(
        `INSERT INTO users (id, role, name, contacts, therapist_id) VALUES ($1, 'client', 'X', 'x', $2)`,
        [bad, SEED_IDS.clientIryna],
      );
      expect(await findClientsWithInvalidTherapist(pool)).toEqual([bad]);
    });

    it('seed is idempotent', async () => {
      await seed(pool);
      const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM users');
      expect(Number(rows[0]?.n)).toBe(SEED_USERS.length);
    });

    it('seed rolls back completely on failure', async () => {
      await pool.query('TRUNCATE therapist_notes, entries, users CASCADE');
      await pool.query(
        'ALTER TABLE therapist_notes ADD CONSTRAINT tmp_fail CHECK (false) NOT VALID',
      );
      try {
        await expect(seed(pool)).rejects.toThrow();
        const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM users');
        expect(Number(rows[0]?.n)).toBe(0);
      } finally {
        await pool.query('ALTER TABLE therapist_notes DROP CONSTRAINT tmp_fail');
      }
    });
  });

  describe('migrations', () => {
    it('re-running applies nothing', async () => {
      expect(await migrate(pool)).toEqual([]);
      const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
      expect(rows.map((r) => r.name)).toEqual(['001_init.sql']);
    });
  });

  describe('schema constraints (spec §5)', () => {
    const insertUser = (role: string, therapistId: string | null) =>
      pool.query(
        `INSERT INTO users (id, role, name, contacts, therapist_id)
         VALUES (gen_random_uuid(), $1, 'X', 'x', $2)`,
        [role, therapistId],
      );
    const insertEntry = (intensity: number) =>
      pool.query(
        `INSERT INTO entries (client_id, situation, thought, emotion, emotion_intensity)
         VALUES ($1, 's', 't', 'e', $2)`,
        [SEED_IDS.clientIryna, intensity],
      );

    it('client without therapist is rejected', async () => {
      await expect(insertUser('client', null)).rejects.toThrow(/users_role_therapist_check/);
    });

    it('therapist with therapist_id is rejected', async () => {
      await expect(insertUser('therapist', SEED_IDS.therapistOlena)).rejects.toThrow(
        /users_role_therapist_check/,
      );
    });

    it('unknown role is rejected', async () => {
      await expect(insertUser('admin', null)).rejects.toThrow(/check constraint/);
    });

    it('valid client and therapist are accepted', async () => {
      await insertUser('client', SEED_IDS.therapistOlena);
      await insertUser('therapist', null);
    });

    it('intensity outside 0..100 is rejected, boundaries accepted', async () => {
      await insertEntry(0);
      await insertEntry(100);
      await expect(insertEntry(101)).rejects.toThrow(/check constraint/);
      await expect(insertEntry(-1)).rejects.toThrow(/check constraint/);
    });

    it('therapist_id must reference an existing user', async () => {
      await expect(insertUser('client', '99999999-9999-4999-8999-999999999999')).rejects.toThrow(
        /foreign key/,
      );
    });
  });

  describe('atomic note creation vs delete (spec §4)', () => {
    const notes = () => new PgNoteRepository(pool);
    const note = { therapistId: SEED_IDS.therapistOlena, text: 'race' };

    it('delete first: note insert waits for it and then gets nothing (→ 409)', async () => {
      const deleter = await pool.connect();
      try {
        await deleter.query('BEGIN');
        await deleter.query('UPDATE entries SET deleted_at = now() WHERE id = $1', [
          SEED_IDS.entryIryna2,
        ]);
        const pending = notes().createIfEntryActive({ ...note, entryId: SEED_IDS.entryIryna2 });
        const raced = await Promise.race([
          pending.then(() => 'finished'),
          new Promise((r) => setTimeout(() => r('waiting'), 300)),
        ]);
        expect(raced).toBe('waiting'); // вставка заблокована незакоміченим видаленням
        await deleter.query('COMMIT');
        expect(await pending).toBeNull();
      } finally {
        deleter.release();
      }
    });

    it('note first: delete waits for the note; the note predates the deletion', async () => {
      const writer = await pool.connect();
      try {
        await writer.query('BEGIN');
        const inserted = await writer.query(
          `INSERT INTO therapist_notes (entry_id, therapist_id, text)
           SELECT e.id, $2, 'first'
           FROM (SELECT id FROM entries WHERE id = $1 AND deleted_at IS NULL FOR SHARE) e
           RETURNING id`,
          [SEED_IDS.entryIryna2, SEED_IDS.therapistOlena],
        );
        expect(inserted.rowCount).toBe(1);
        const pendingDelete = pool.query(
          'UPDATE entries SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
          [SEED_IDS.entryIryna2],
        );
        const raced = await Promise.race([
          pendingDelete.then(() => 'finished'),
          new Promise((r) => setTimeout(() => r('waiting'), 300)),
        ]);
        expect(raced).toBe('waiting');
        await writer.query('COMMIT');
        expect((await pendingDelete).rowCount).toBe(1);
        const { rows } = await pool.query<{ ok: boolean }>(
          `SELECT bool_and(n.created_at <= e.deleted_at) AS ok
           FROM therapist_notes n JOIN entries e ON e.id = n.entry_id WHERE e.id = $1`,
          [SEED_IDS.entryIryna2],
        );
        expect(rows[0]?.ok).toBe(true);
      } finally {
        writer.release();
      }
    });

    it('many parallel note/delete pairs never leave a note created after deletion', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 30; i++) {
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO entries (client_id, situation, thought, emotion, emotion_intensity)
           VALUES ($1, 'r', 't', 'e', 1) RETURNING id`,
          [SEED_IDS.clientMaksym],
        );
        ids.push(rows[0]?.id ?? '');
      }
      await Promise.all(
        ids.flatMap((id) => [
          notes().createIfEntryActive({ ...note, entryId: id }),
          pool.query('UPDATE entries SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL', [
            id,
          ]),
        ]),
      );
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM therapist_notes n JOIN entries e ON e.id = n.entry_id
         WHERE e.deleted_at IS NOT NULL AND n.created_at > e.deleted_at`,
      );
      expect(Number(rows[0]?.n)).toBe(0);
    });
  });
});
