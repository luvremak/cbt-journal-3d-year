# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/uk/1.1.0/), версії — [SemVer](https://semver.org/lang/uk/).

## [1.0.0] — 2026-11-09

### Додано

- Винесено з `src/lib/di` застосунку CBT Journal в окремий пакет `@cbt-journal/di`.
- `register(token, factory, { lifetime, dispose })` — об'єкт опцій поряд зі старою формою `register(token, factory, 'transient')`.
- `Container.dispose()` — звільнення singleton-ів у зворотному порядку створення, `AggregateError` для невдалих.
- `ContainerDisposedError` — `resolve` після `dispose`.

### Без змін

- `createToken`, `resolve`, `has`, `registerValue`, singleton / transient, `DependencyNotRegisteredError`, `CircularDependencyError`.
