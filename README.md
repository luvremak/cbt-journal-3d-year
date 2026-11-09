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

Списки (`GET` клієнтів, записів, нотаток) віддаються сторінками: `?limit=` (1–100, за замовчуванням 50) і `?offset=` (≥ 0). Порядок — від нових до старих, далі за `id` (клієнти — за ім'ям). Остання сторінка — коли прийшло менше за `limit`.

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

## Тести

```bash
make db-up          # PostgreSQL потрібен для повного прогону
make test           # 305 тестів: unit + інтеграційні + E2E (memory і PostgreSQL)
make test-nodb      # без БД (unit + in-memory частина)
make coverage       # покриття → консоль і reports/coverage/
make mutation       # Stryker (поріг 80 %, зараз 100 %) → reports/index.html
make mutation-sql   # мутанти SQL-умов із test/sql-mutants.tsv (зараз 13/13)
make report         # усе разом → reports/index.html
```

`reports/index.html` — звіт якості однією сторінкою: вердикт, кожен мутант як клітинка, що виправити, тести за рівнями, покриття, мутації за файлами з тестом, який впіймав кожну зміну, і SQL-умови. Шрифти вбудовані, тож файл відкривається без інтернету.

Тестова база — `cbt_test` у тому ж PostgreSQL (змінна `TEST_DATABASE_URL`); схема перестворюється на кожен прогін. Правила — у [standards/testing.md](standards/testing.md).

## Git-hooks

- **pre-commit:** lint-staged (ESLint + Prettier на змінених файлах), `typecheck` і unit-тести.
- **commit-msg:** commitlint — повідомлення коміту має бути у форматі Conventional Commits (`feat: …`, `fix: …`, `docs: …`).

## Структура репозиторію

```
src/          код застосунку
migrations/   SQL-міграції
standards/    правила розробки (код, git, тести)
test/         unit/, integration/, e2e/, helpers/
scripts/      допоміжні скрипти (мутації SQL)
ai/           слід роботи з AI: питання й відповіді дослівно
audit/        аудити по завданнях (топ-3 знахідки)
spec.md       специфікація: ролі, модулі, бізнес-правила, ER
```

## Автентифікація

Справжньої авторизації немає (див. spec, Out of Scope): поточний користувач передається заголовком `X-User-Id`.
