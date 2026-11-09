.PHONY: install dev build start db-up db-down db-migrate db-seed db-setup check lint format typecheck

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
