import { SEED_IDS } from '../src/seed-data.js';

/** Обсяг даних і ролі для навантажувального тесту (див. perf/README.md). */
export const PERF = {
  therapists: 20,
  clientsPerTherapist: 25,
  entriesPerClient: 200,
  heavyClientEntries: 2000,
  heavyClient: SEED_IDS.clientMaksym,
  therapist: SEED_IDS.therapistOlena,
};
