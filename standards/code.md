# Стандарти коду

## Мова та інструменти

- TypeScript у режимі `strict`, ESM (`"type": "module"`).
- Стиль коду визначає Prettier, якість — ESLint (`typescript-eslint` strict). Обидва запускаються в pre-commit hook; вручну — `make check`.
- `any` заборонено; для невідомих даних — `unknown` з перевіркою.
- `console.*` лише в точці входу; далі — логер (з'явиться в Завданні 2).

## Іменування

| Що                      | Як               | Приклад                    |
| ----------------------- | ---------------- | -------------------------- |
| файли                   | kebab-case       | `entry-service.ts`         |
| класи, типи, інтерфейси | PascalCase       | `EntryService`, `Entry`    |
| змінні, функції         | camelCase        | `findEntriesByClient`      |
| константи модуля        | UPPER_SNAKE_CASE | `MAX_INTENSITY`            |
| таблиці й колонки БД    | snake_case       | `therapist_notes.entry_id` |

## Архітектура (шари)

```
routes → services → repositories → PostgreSQL
```

- **routes** — HTTP: розбір запиту, валідація вхідних даних, код відповіді. Без бізнес-логіки.
- **services** — бізнес-правила зі spec (хто що бачить, soft delete, незмінність записів).
- **repositories** — лише SQL. Без бізнес-рішень.
- Залежності передаються через DI (конструктор), а не імпортуються напряму між шарами. Контейнер — бібліотека `@cbt-journal/di` з `packages/di`; застосунок не імпортує її внутрішні файли, лише публічний API пакета.

## Помилки

- Сервіси кидають доменні помилки (`NotFoundError`, `ValidationError`, …); у HTTP-коди їх перетворює глобальний обробник.
- Чужий ресурс → `404`, а не `403` (spec, розділ 7).
