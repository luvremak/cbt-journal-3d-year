# Git-процес

## Гілки

- `main` — лише через Pull Request.
- Кожне завдання курсу — окрема гілка `task-N-<коротко>` (наприклад, `task-1-foundation`) → PR у `main`.
- Історію гілки після того, як її показали (PR відкрито), не переписуємо: без `force-push` і `rebase -i`.

## Коміти

- Формат [Conventional Commits](https://www.conventionalcommits.org/): `тип(область): опис`.
- Типи: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `perf`.
- Перевіряється автоматично commitlint у hook `commit-msg`.
- Коміти, зроблені з AI, мають трейлер `Co-Authored-By`.

## Слід роботи з AI

- Питання, які ставить AI, і відповіді студентки зберігаються дослівно в `ai/`.
- `spec.md` і `DEFENSE.md` студентка пише сама; AI лише ставить питання і перевіряє на прогалини.
