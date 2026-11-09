# @cbt-journal/di

Маленький типізований контейнер залежностей для TypeScript / Node.js. Без залежностей, без декораторів і без `reflect-metadata`: залежності описуються звичайними функціями-фабриками, а тип кожної залежності прив'язаний до її токена.

Винесено із застосунку CBT Journal (Завдання 5). Застосунок підключає пакет як звичайну залежність `@cbt-journal/di`.

## Можливості

- **Типізовані токени.** `resolve(token)` повертає правильний тип без приведень.
- **Singleton і transient.** Singleton створюється ліниво при першому `resolve`.
- **Виявлення циклів** з ланцюжком у повідомленні: `Circular dependency: A -> B -> A`.
- **`dispose()`** — звільнення ресурсів (пул з'єднань, файли) у зворотному порядку створення.
- **Підміна в тестах:** `register` / `registerValue` для того самого токена до першого `resolve`.

## Приклад

```ts
import { Container, createToken } from '@cbt-journal/di';
import pg from 'pg';

const TOKENS = {
  pool: createToken<pg.Pool>('pool'),
  users: createToken<UserRepository>('users'),
};

const c = new Container()
  .register(TOKENS.pool, () => new pg.Pool({ connectionString: process.env.DATABASE_URL }), {
    dispose: (pool) => pool.end(),
  })
  .register(TOKENS.users, (c) => new PgUserRepository(c.resolve(TOKENS.pool)));

const users = c.resolve(TOKENS.users); // тип: UserRepository

process.on('SIGTERM', () => void c.dispose()); // закриє пул
```

## API

| Метод                                   | Що робить                                                                                                                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createToken<T>(description)`           | Новий унікальний ключ. `description` — для повідомлень про помилки.                                                                                                  |
| `register(token, factory, options?)`    | Фабрика `(container) => T`. `options`: `'singleton'` / `'transient'` або `{ lifetime, dispose }`.                                                                    |
| `registerValue(token, value, options?)` | Готове значення (singleton). `options`: `{ dispose }`.                                                                                                               |
| `resolve(token)`                        | Екземпляр. Помилки: `DependencyNotRegisteredError`, `CircularDependencyError`, `ContainerDisposedError`.                                                             |
| `has(token)`                            | Чи зареєстровано.                                                                                                                                                    |
| `dispose()`                             | Викликає `dispose` створених singleton-ів у зворотному порядку. Ідемпотентний. Якщо деякі впали, решта все одно виконуються, а помилки приходять в `AggregateError`. |

### Правила

- `dispose` дозволено лише для singleton (`TypeError` для transient).
- Перереєстрація скидає вже створений екземпляр **без** виклику його `dispose`. Тому перереєстровуйте до першого `resolve` (composition root, тести).
- Після `dispose()` будь-який `resolve` кидає `ContainerDisposedError`.

## Якість

```bash
npm test -w @cbt-journal/di        # 23 тести
npm run mutation -w @cbt-journal/di # Stryker, поріг 90 %, зараз 100 %
```

Еквівалентні мутанти позначено в коді коментарем `Stryker disable` з поясненням.
