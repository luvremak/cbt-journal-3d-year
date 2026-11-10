-- migrate:no-transaction
-- Старий індекс (client_id, created_at DESC) повністю покривається 004; попередня
-- версія коду теж його не потребує (той самий префікс), тож видалення сумісне.
DROP INDEX CONCURRENTLY IF EXISTS entries_client_created_idx;
