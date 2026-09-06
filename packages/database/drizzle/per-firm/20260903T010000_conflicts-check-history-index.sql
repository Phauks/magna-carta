-- The firm-wide conflicts check history, newest first.
--
-- conflicts_check already carries (subject_matter_id, created_at, id), which serves ONE matter's own
-- history: the matter narrows the walk and the remaining columns carry the order. It cannot serve a
-- listing across every matter, because nothing leads with the sort key — the load-profile plan probe
-- (conflicts.check-history-firm-wide) measured that read as a full table SCAN of conflicts_check.
--
-- A conflicts log only ever grows: it is append-only by design, with RAISE(ABORT) triggers refusing
-- UPDATE and DELETE, so a scan there is not a fixed cost but one that rises every week a firm
-- operates. This index leads with (created_at, id) so the firm-wide walk stops at the page.
CREATE INDEX IF NOT EXISTS conflicts_check_created_id_index
  ON conflicts_check (created_at, id);
