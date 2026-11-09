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
make check             # typecheck + lint + format:check
```

## Команди

| Команда                           | Що робить                       |
| --------------------------------- | ------------------------------- |
| `npm run build`                   | компіляція TypeScript у `dist/` |
| `npm run typecheck`               | перевірка типів без компіляції  |
| `npm run lint` / `lint:fix`       | ESLint                          |
| `npm run format` / `format:check` | Prettier                        |
| `make db-up` / `make db-down`     | запуск / зупинка PostgreSQL     |

## Git-hooks

- **pre-commit:** lint-staged (ESLint + Prettier на змінених файлах) і `typecheck`.
- **commit-msg:** commitlint — повідомлення коміту має бути у форматі Conventional Commits (`feat: …`, `fix: …`, `docs: …`).

## Структура репозиторію

```
src/          код застосунку
standards/    правила розробки (код, git, архітектура)
ai/           слід роботи з AI: питання й відповіді дослівно
spec.md       специфікація: ролі, модулі, бізнес-правила, ER
```

## Автентифікація

Справжньої авторизації немає (див. spec, Out of Scope): поточний користувач передається заголовком `X-User-Id`.
