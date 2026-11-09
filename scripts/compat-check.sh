#!/usr/bin/env bash
# Перевірка міграцій без простою: стара версія застосунку мусить працювати
# на схемі, вже оновленій новою версією (так і буває під час деплою).
#
#   scripts/compat-check.sh <старий_checkout> <новий_checkout>
#
# Потрібен DATABASE_URL на порожню БД. Обидва каталоги мають містити встановлені
# залежності (npm ci) і зібраний код (npm run build).
#   1. стара версія: міграції + seed, запуск на :4101
#   2. нова версія: лише міграції (стара версія при цьому працює)
#   3. smoke нової версії проти СТАРОГО сервера → старий код живий на новій схемі
#   4. запуск нової версії на :4102, smoke → новий код працює
set -euo pipefail
old=$(cd "$1" && pwd)
new=$(cd "$2" && pwd)
: "${DATABASE_URL:?DATABASE_URL is required}"
export STORAGE=postgres LOG_LEVEL=warn

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

echo "== old version: migrate + seed + start"
(cd "$old" && node dist/db/migrate.js && node dist/db/seed.js)
(cd "$old" && PORT=4101 node dist/index.js) &
pids+=($!)

echo "== new version: migrate while the old one is serving"
(cd "$new" && node dist/db/migrate.js)

echo "== old server on the new schema"
node "$new/scripts/smoke.mjs" http://localhost:4101 --wait 30

echo "== new version: start + smoke"
(cd "$new" && PORT=4102 node dist/index.js) &
pids+=($!)
node "$new/scripts/smoke.mjs" http://localhost:4102 --wait 30

echo "compat: old and new versions both work on the new schema"
