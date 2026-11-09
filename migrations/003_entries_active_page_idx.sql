-- migrate:no-transaction
-- perf: сторінки активних записів клієнта (spec §4: created_at DESC, id DESC, offset).
-- Покривний частковий індекс → deferred join читає лише індекс для пропущених offset-рядків.
-- CONCURRENTLY: не блокує записи в entries під час деплою (standards/migrations.md).
CREATE INDEX CONCURRENTLY IF NOT EXISTS entries_client_active_page_idx
  ON entries (client_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
