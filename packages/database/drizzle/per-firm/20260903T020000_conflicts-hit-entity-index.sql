-- "What has this firm already said about this party?"
--
-- A reviewer answering a hit is shown, as CONTEXT, whether an earlier check surfaced the same party
-- and how that one was answered. The read matches conflicts_hit on entity_id across every check but
-- the one in hand, and conflicts_hit carried only (check_id) — so that read scanned the table.
--
-- conflicts_hit is append-only, with RAISE(ABORT) triggers refusing UPDATE and DELETE, so a scan of
-- it is not a fixed cost: it rises every week the firm operates. created_at trails entity_id so the
-- rows for one party come back already in time order, which is how the most recent earlier answer
-- is picked.
CREATE INDEX IF NOT EXISTS conflicts_hit_entity_created_index
  ON conflicts_hit (entity_id, created_at);
