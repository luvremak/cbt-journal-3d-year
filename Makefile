.PHONY: install db-up db-down check lint format typecheck

install:
	npm ci

db-up:
	docker compose up -d db

db-down:
	docker compose down

check:
	npm run check

lint:
	npm run lint

format:
	npm run format

typecheck:
	npm run typecheck
