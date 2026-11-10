-- migrate:no-transaction
-- perf: сторінки всіх записів клієнта для терапевта (разом із видаленими).
CREATE INDEX CONCURRENTLY IF NOT EXISTS entries_client_page_idx
  ON entries (client_id, created_at DESC, id DESC);
