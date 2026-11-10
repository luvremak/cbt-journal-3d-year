import { SEED_IDS } from '../src/seed-data.js';

/** Обсяг даних і ролі для навантажувального тесту (див. perf/README.md). */
export const PERF = {
  therapists: 20,
  clientsPerTherapist: 25,
  entriesPerClient: 140,
  heavyClientEntries: 2000,
  heavyClient: SEED_IDS.clientMaksym,
  therapist: SEED_IDS.therapistOlena,
  /** Клієнт, чиї записи видаляє сценарій DELETE (кожен запит — інший запис). */
  deleteClient: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  deleteClientEntries: 30_000,
  /** DELETE рахуємо кількістю запитів, а не часом: прогрів + 3 прогони мають уміститися в запас. */
  deleteRequestsPerRun: 8_000,
  deleteWarmupRequests: 1_000,
};
