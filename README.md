# CBT Journal

Спрощений журнал когнітивно-поведінкової терапії (КПТ). Клієнт швидко записує думку в момент тригера (ситуація → думка → емоція + інтенсивність 0–100 → раціональна відповідь), а його терапевт читає записи й веде приватні нотатки.

Проєкт — лише backend REST API. Повний опис вимог: [spec.md](spec.md).

## Стек

- Node.js 22 + TypeScript
- PostgreSQL 17 (локально в Docker)
- ESLint + Prettier, git-hooks через simple-git-hooks, commitlint (Conventional Commits)

## Швидкий старт

```bash
npm ci                 # залежності + встановлення git-hooks
cp .env.example .env   # змінні оточення
make db-up             # PostgreSQL у Docker
make db-setup          # міграції + тестові користувачі (seed)
make dev               # сервер на http://localhost:3000
```

Без бази: `STORAGE=memory npm run dev` — ті самі дані, але в пам'яті (статика).

## Команди

| Команда                           | Що робить                       |
| --------------------------------- | ------------------------------- |
| `npm run dev`                     | сервер з автоперезапуском       |
| `npm run db:migrate` / `db:seed`  | міграції / тестові дані         |
| `npm run build`                   | компіляція TypeScript у `dist/` |
| `npm run typecheck`               | перевірка типів без компіляції  |
| `npm run lint` / `lint:fix`       | ESLint                          |
| `npm run format` / `format:check` | Prettier                        |
| `make db-up` / `make db-down`     | запуск / зупинка PostgreSQL     |

## API

Усі запити, крім `/health`, вимагають заголовок `X-User-Id` (UUID користувача з seed).
Поля в JSON — як у spec (`emotion_intensity`, `rational_response`, …).

| Метод    | Шлях                                   | Роль     | Що робить                                         |
| -------- | -------------------------------------- | -------- | ------------------------------------------------- |
| `GET`    | `/health`                              | —        | перевірка, що сервер живий                        |
| `POST`   | `/client/entries`                      | клієнт   | створити запис → `201`                            |
| `GET`    | `/client/entries`                      | клієнт   | свої активні записи, від нових до старих          |
| `GET`    | `/client/entries/:id`                  | клієнт   | свій активний запис                               |
| `DELETE` | `/client/entries/:id`                  | клієнт   | soft delete → `204`                               |
| `GET`    | `/client/therapist`                    | клієнт   | ім'я і контакти свого терапевта                   |
| `GET`    | `/therapist/clients`                   | терапевт | свої клієнти                                      |
| `GET`    | `/therapist/clients/:clientId/entries` | терапевт | записи клієнта; видалені — лише `id`, дати        |
| `GET`    | `/therapist/entries/:entryId/notes`    | терапевт | свої нотатки до запису                            |
| `POST`   | `/therapist/entries/:entryId/notes`    | терапевт | нова нотатка → `201` (до видаленого запису `409`) |

Помилки мають єдиний формат: `{ "error": { "code", "message", "details"? }, "bp_id" }`.

### Тестові користувачі

| Хто                       | `X-User-Id`                            |
| ------------------------- | -------------------------------------- |
| Терапевт Олена Коваль     | `11111111-1111-4111-8111-111111111111` |
| Терапевт Андрій Мельник   | `22222222-2222-4222-8222-222222222222` |
| Клієнтка Ірина (→ Олена)  | `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` |
| Клієнт Максим (→ Олена)   | `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb` |
| Клієнтка Софія (→ Андрій) | `cccccccc-cccc-4ccc-8ccc-cccccccccccc` |

```bash
curl -H 'X-User-Id: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' localhost:3000/client/entries
```

## Архітектура

```
routes → services → repositories → PostgreSQL / пам'ять
```

- **DI:** власний контейнер `src/lib/di/container.ts`; усі залежності збираються в `src/container.ts` (composition root). Режим `STORAGE` лише підміняє реалізації репозиторіїв.
- **Бізнес-процес:** кожен запит отримує `bpId` (або бере з заголовка `X-Business-Process-Id`). Він є в кожному рядку логу (pino + AsyncLocalStorage) і повертається в заголовку відповіді та в тілі помилок.
- **Помилки:** сервіси кидають доменні помилки (`src/lib/errors.ts`), глобальний обробник перетворює їх на HTTP-коди за spec.
- **Міграції:** `migrations/*.sql`, застосовуються `npm run db:migrate` і запам'ятовуються в `schema_migrations`.

## Git-hooks

- **pre-commit:** lint-staged (ESLint + Prettier на змінених файлах) і `typecheck`.
- **commit-msg:** commitlint — повідомлення коміту має бути у форматі Conventional Commits (`feat: …`, `fix: …`, `docs: …`).

## Структура репозиторію

```
src/          код застосунку
migrations/   SQL-міграції
standards/    правила розробки (код, git, архітектура)
ai/           слід роботи з AI: питання й відповіді дослівно
audit/        аудити по завданнях (топ-3 знахідки)
spec.md       специфікація: ролі, модулі, бізнес-правила, ER
```

## Автентифікація

Справжньої авторизації немає (див. spec, Out of Scope): поточний користувач передається заголовком `X-User-Id`.
