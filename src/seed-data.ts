import type { Entry } from './modules/entries/entry.js';
import type { Note } from './modules/notes/note.js';
import type { User } from './modules/users/user.js';

/**
 * Статичні дані (реєстрації немає, spec §7). Фіксовані UUID, щоб ними
 * можна було користуватися в X-User-Id. Ті самі дані йдуть у seed БД.
 */
export const SEED_IDS = {
  therapistOlena: '11111111-1111-4111-8111-111111111111',
  therapistAndrii: '22222222-2222-4222-8222-222222222222',
  clientIryna: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  clientMaksym: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  clientSofiia: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  entryIryna1: 'e1111111-0000-4000-8000-000000000001',
  entryIryna2: 'e1111111-0000-4000-8000-000000000002',
  entrySofiia1: 'e3333333-0000-4000-8000-000000000001',
  noteIryna1: 'f1111111-0000-4000-8000-000000000001',
} as const;

export const SEED_USERS: readonly User[] = [
  {
    id: SEED_IDS.therapistOlena,
    role: 'therapist',
    name: 'Олена Коваль',
    contacts: 'olena.koval@example.com, +380 50 000 0001',
    therapistId: null,
  },
  {
    id: SEED_IDS.therapistAndrii,
    role: 'therapist',
    name: 'Андрій Мельник',
    contacts: 'andrii.melnyk@example.com, +380 50 000 0002',
    therapistId: null,
  },
  {
    id: SEED_IDS.clientIryna,
    role: 'client',
    name: 'Ірина',
    contacts: 'iryna@example.com',
    therapistId: SEED_IDS.therapistOlena,
  },
  {
    id: SEED_IDS.clientMaksym,
    role: 'client',
    name: 'Максим',
    contacts: 'maksym@example.com',
    therapistId: SEED_IDS.therapistOlena,
  },
  {
    id: SEED_IDS.clientSofiia,
    role: 'client',
    name: 'Софія',
    contacts: 'sofiia@example.com',
    therapistId: SEED_IDS.therapistAndrii,
  },
];

export const SEED_ENTRIES: readonly Entry[] = [
  {
    id: SEED_IDS.entryIryna1,
    clientId: SEED_IDS.clientIryna,
    situation: 'Керівник не відповів на моє повідомлення',
    thought: 'Він незадоволений моєю роботою',
    emotion: 'тривога',
    emotionIntensity: 70,
    rationalResponse: 'Він міг бути зайнятий; раніше він хвалив мою роботу',
    createdAt: new Date('2026-11-01T09:15:00Z'),
    deletedAt: null,
  },
  {
    id: SEED_IDS.entryIryna2,
    clientId: SEED_IDS.clientIryna,
    situation: 'Подруга скасувала зустріч',
    thought: 'Я їй нецікава',
    emotion: 'смуток',
    emotionIntensity: 55,
    rationalResponse: null,
    createdAt: new Date('2026-11-03T18:40:00Z'),
    deletedAt: null,
  },
  {
    id: SEED_IDS.entrySofiia1,
    clientId: SEED_IDS.clientSofiia,
    situation: 'Виступ на парі',
    thought: 'Я все забуду і всі сміятимуться',
    emotion: 'страх',
    emotionIntensity: 85,
    rationalResponse: null,
    createdAt: new Date('2026-11-02T11:00:00Z'),
    deletedAt: null,
  },
];

export const SEED_NOTES: readonly Note[] = [
  {
    id: SEED_IDS.noteIryna1,
    entryId: SEED_IDS.entryIryna1,
    therapistId: SEED_IDS.therapistOlena,
    text: 'Типове «читання думок». Обговорити на сесії.',
    createdAt: new Date('2026-11-01T20:00:00Z'),
  },
];
