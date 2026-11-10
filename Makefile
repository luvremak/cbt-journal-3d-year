.PHONY: install dev build start db-up db-down db-migrate db-seed db-setup check lint format typecheck \
        test test-nodb test-unit coverage mutation mutation-sql report perf

install:
	npm ci

dev:
	npm run dev

build:
	npm run build

start:
	npm start

db-up:
	docker compose up -d db

db-down:
	docker compose down

db-migrate:
	npm run db:migrate

db-seed:
	npm run db:seed

db-setup: db-migrate db-seed

check:
	npm run check

lint:
	npm run lint

format:
	npm run format

typecheck:
	npm run typecheck

# Усі тести, включно з PostgreSQL (потрібен `make db-up`).
test:
	npm test

# Без БД: unit + in-memory частина контрактних і E2E тестів.
test-nodb:
	npm run test:nodb

test-unit:
	npm run test:unit

coverage:
	npm run test:coverage

# Мутаційне тестування коду (Stryker). Звіт якості оновлюється: reports/index.html
mutation:
	npm run mutation
	npm run mutation:di
	npm run report

# Мутаційне тестування SQL-умов у репозиторіях (потрібен `make db-up`).
mutation-sql:
	npm run mutation:sql
	npm run report

# Повний звіт якості: тести + покриття + мутації + SQL → reports/index.html (потрібен `make db-up`)
report:
	npm run test:report
	npm run mutation
	npm run mutation:di
	npm run mutation:sql
	npm run report

# Навантажувальний тест на ~100 тис. записів (потрібен `make db-up`). Результат: reports/perf.json
PERF_DATABASE_URL ?= postgres://cbt:cbt@localhost:5432/cbt_perf
perf:
	npm run build
	PERF_DATABASE_URL=$(PERF_DATABASE_URL) npm run perf:prepare
	PERF_DATABASE_URL=$(PERF_DATABASE_URL) npm run perf -- --budget-p99 50
	npm run report
