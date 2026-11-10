-- The record index: the firm's full-text index over the short text held in its own rows.
--
-- Two tables. `record_text_entry` is one ordinary row per indexed record. `record_text_fts` is a
-- contentless full-text table keyed by that row's id: it holds terms and positions and none of the
-- text, so a match is a pointer and the words a reader sees are read from the record itself.
--
-- Everything after the two tables is RENDERED, not written by hand, from the sources declared in
-- packages/search/src/record-index-sources.ts by
-- `node packages/search/scripts/render-record-index-migration.mts --with-table`: for each source,
-- the triggers that keep its index rows current in the statement that changes a record, then the
-- two statements that index the records the firm already holds. The triggers and the fill share
-- one migration so that no record can be written between them.
CREATE TABLE `record_text_entry` (
	`id` integer PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`record_id` text NOT NULL,
	`container_id` text,
	`matter_id` text,
	`sort_key` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `record_text_entry_source_record_unique` ON `record_text_entry` (`source`,`record_id`);--> statement-breakpoint
CREATE INDEX `record_text_entry_source_container_index` ON `record_text_entry` (`source`,`container_id`);--> statement-breakpoint
CREATE VIRTUAL TABLE `record_text_fts` USING fts5(scope, title, body, content='', contentless_delete=1, tokenize="unicode61 remove_diacritics 2");
--> statement-breakpoint
CREATE TRIGGER `record_text_notes_insert` AFTER INSERT ON `matter_note` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'notes' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'notes' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'notes', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT matter_note.id AS record_id, NULL AS container_id, matter_note.matter_id AS matter_id, COALESCE(matter_note.occurred_on, substr(matter_note.created_at, 1, 10)) AS sort_key, NULL AS title, matter_note.body AS body FROM `matter_note` WHERE matter_note.id = new.id AND TRIM(COALESCE(NULL, '') || COALESCE(matter_note.body, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT matter_note.id AS record_id, NULL AS container_id, matter_note.matter_id AS matter_id, COALESCE(matter_note.occurred_on, substr(matter_note.created_at, 1, 10)) AS sort_key, NULL AS title, matter_note.body AS body FROM `matter_note` WHERE matter_note.id = new.id AND TRIM(COALESCE(NULL, '') || COALESCE(matter_note.body, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'notes' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_notes_update` AFTER UPDATE OF `matter_id`, `body`, `occurred_on` ON `matter_note` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'notes' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'notes' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'notes', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT matter_note.id AS record_id, NULL AS container_id, matter_note.matter_id AS matter_id, COALESCE(matter_note.occurred_on, substr(matter_note.created_at, 1, 10)) AS sort_key, NULL AS title, matter_note.body AS body FROM `matter_note` WHERE matter_note.id = new.id AND TRIM(COALESCE(NULL, '') || COALESCE(matter_note.body, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT matter_note.id AS record_id, NULL AS container_id, matter_note.matter_id AS matter_id, COALESCE(matter_note.occurred_on, substr(matter_note.created_at, 1, 10)) AS sort_key, NULL AS title, matter_note.body AS body FROM `matter_note` WHERE matter_note.id = new.id AND TRIM(COALESCE(NULL, '') || COALESCE(matter_note.body, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'notes' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_notes_delete` AFTER DELETE ON `matter_note` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'notes' AND record_id = old.id);
  DELETE FROM `record_text_entry` WHERE source = 'notes' AND record_id = old.id;
END;
--> statement-breakpoint
INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'notes', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT matter_note.id AS record_id, NULL AS container_id, matter_note.matter_id AS matter_id, COALESCE(matter_note.occurred_on, substr(matter_note.created_at, 1, 10)) AS sort_key, NULL AS title, matter_note.body AS body FROM `matter_note` WHERE 1 AND TRIM(COALESCE(NULL, '') || COALESCE(matter_note.body, '')) <> '') AS derived;
--> statement-breakpoint
INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT matter_note.id AS record_id, NULL AS container_id, matter_note.matter_id AS matter_id, COALESCE(matter_note.occurred_on, substr(matter_note.created_at, 1, 10)) AS sort_key, NULL AS title, matter_note.body AS body FROM `matter_note` WHERE 1 AND TRIM(COALESCE(NULL, '') || COALESCE(matter_note.body, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'notes' AND entry.record_id = derived.record_id;
--> statement-breakpoint
CREATE TRIGGER `record_text_time_insert` AFTER INSERT ON `time_entry` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'time' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'time' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'time', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT time_entry.id AS record_id, NULL AS container_id, time_entry.matter_id AS matter_id, time_entry.work_date AS sort_key, NULL AS title, time_entry.narrative AS body FROM `time_entry` WHERE time_entry.id = new.id AND TRIM(COALESCE(NULL, '') || COALESCE(time_entry.narrative, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT time_entry.id AS record_id, NULL AS container_id, time_entry.matter_id AS matter_id, time_entry.work_date AS sort_key, NULL AS title, time_entry.narrative AS body FROM `time_entry` WHERE time_entry.id = new.id AND TRIM(COALESCE(NULL, '') || COALESCE(time_entry.narrative, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'time' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_time_update` AFTER UPDATE OF `matter_id`, `narrative`, `work_date` ON `time_entry` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'time' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'time' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'time', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT time_entry.id AS record_id, NULL AS container_id, time_entry.matter_id AS matter_id, time_entry.work_date AS sort_key, NULL AS title, time_entry.narrative AS body FROM `time_entry` WHERE time_entry.id = new.id AND TRIM(COALESCE(NULL, '') || COALESCE(time_entry.narrative, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT time_entry.id AS record_id, NULL AS container_id, time_entry.matter_id AS matter_id, time_entry.work_date AS sort_key, NULL AS title, time_entry.narrative AS body FROM `time_entry` WHERE time_entry.id = new.id AND TRIM(COALESCE(NULL, '') || COALESCE(time_entry.narrative, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'time' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_time_delete` AFTER DELETE ON `time_entry` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'time' AND record_id = old.id);
  DELETE FROM `record_text_entry` WHERE source = 'time' AND record_id = old.id;
END;
--> statement-breakpoint
INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'time', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT time_entry.id AS record_id, NULL AS container_id, time_entry.matter_id AS matter_id, time_entry.work_date AS sort_key, NULL AS title, time_entry.narrative AS body FROM `time_entry` WHERE 1 AND TRIM(COALESCE(NULL, '') || COALESCE(time_entry.narrative, '')) <> '') AS derived;
--> statement-breakpoint
INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT time_entry.id AS record_id, NULL AS container_id, time_entry.matter_id AS matter_id, time_entry.work_date AS sort_key, NULL AS title, time_entry.narrative AS body FROM `time_entry` WHERE 1 AND TRIM(COALESCE(NULL, '') || COALESCE(time_entry.narrative, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'time' AND entry.record_id = derived.record_id;
--> statement-breakpoint
CREATE TRIGGER `record_text_costs_insert` AFTER INSERT ON `cost_entry` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'costs' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'costs' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'costs', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT cost_entry.id AS record_id, NULL AS container_id, cost_entry.matter_id AS matter_id, cost_entry.incurred_date AS sort_key, cost_entry.description AS title, NULL AS body FROM `cost_entry` WHERE cost_entry.id = new.id AND TRIM(COALESCE(cost_entry.description, '') || COALESCE(NULL, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT cost_entry.id AS record_id, NULL AS container_id, cost_entry.matter_id AS matter_id, cost_entry.incurred_date AS sort_key, cost_entry.description AS title, NULL AS body FROM `cost_entry` WHERE cost_entry.id = new.id AND TRIM(COALESCE(cost_entry.description, '') || COALESCE(NULL, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'costs' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_costs_update` AFTER UPDATE OF `matter_id`, `description`, `incurred_date` ON `cost_entry` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'costs' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'costs' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'costs', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT cost_entry.id AS record_id, NULL AS container_id, cost_entry.matter_id AS matter_id, cost_entry.incurred_date AS sort_key, cost_entry.description AS title, NULL AS body FROM `cost_entry` WHERE cost_entry.id = new.id AND TRIM(COALESCE(cost_entry.description, '') || COALESCE(NULL, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT cost_entry.id AS record_id, NULL AS container_id, cost_entry.matter_id AS matter_id, cost_entry.incurred_date AS sort_key, cost_entry.description AS title, NULL AS body FROM `cost_entry` WHERE cost_entry.id = new.id AND TRIM(COALESCE(cost_entry.description, '') || COALESCE(NULL, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'costs' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_costs_delete` AFTER DELETE ON `cost_entry` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'costs' AND record_id = old.id);
  DELETE FROM `record_text_entry` WHERE source = 'costs' AND record_id = old.id;
END;
--> statement-breakpoint
INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'costs', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT cost_entry.id AS record_id, NULL AS container_id, cost_entry.matter_id AS matter_id, cost_entry.incurred_date AS sort_key, cost_entry.description AS title, NULL AS body FROM `cost_entry` WHERE 1 AND TRIM(COALESCE(cost_entry.description, '') || COALESCE(NULL, '')) <> '') AS derived;
--> statement-breakpoint
INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT cost_entry.id AS record_id, NULL AS container_id, cost_entry.matter_id AS matter_id, cost_entry.incurred_date AS sort_key, cost_entry.description AS title, NULL AS body FROM `cost_entry` WHERE 1 AND TRIM(COALESCE(cost_entry.description, '') || COALESCE(NULL, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'costs' AND entry.record_id = derived.record_id;
--> statement-breakpoint
CREATE TRIGGER `record_text_calendar_insert` AFTER INSERT ON `matter_event` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'calendar' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'calendar' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'calendar', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT matter_event.id AS record_id, NULL AS container_id, matter_event.matter_id AS matter_id, matter_event.starts_on AS sort_key, matter_event.title AS title, matter_event.description AS body FROM `matter_event` WHERE matter_event.id = new.id AND TRIM(COALESCE(matter_event.title, '') || COALESCE(matter_event.description, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT matter_event.id AS record_id, NULL AS container_id, matter_event.matter_id AS matter_id, matter_event.starts_on AS sort_key, matter_event.title AS title, matter_event.description AS body FROM `matter_event` WHERE matter_event.id = new.id AND TRIM(COALESCE(matter_event.title, '') || COALESCE(matter_event.description, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'calendar' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_calendar_update` AFTER UPDATE OF `matter_id`, `title`, `description`, `starts_on` ON `matter_event` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'calendar' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'calendar' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'calendar', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT matter_event.id AS record_id, NULL AS container_id, matter_event.matter_id AS matter_id, matter_event.starts_on AS sort_key, matter_event.title AS title, matter_event.description AS body FROM `matter_event` WHERE matter_event.id = new.id AND TRIM(COALESCE(matter_event.title, '') || COALESCE(matter_event.description, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT matter_event.id AS record_id, NULL AS container_id, matter_event.matter_id AS matter_id, matter_event.starts_on AS sort_key, matter_event.title AS title, matter_event.description AS body FROM `matter_event` WHERE matter_event.id = new.id AND TRIM(COALESCE(matter_event.title, '') || COALESCE(matter_event.description, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'calendar' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_calendar_delete` AFTER DELETE ON `matter_event` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'calendar' AND record_id = old.id);
  DELETE FROM `record_text_entry` WHERE source = 'calendar' AND record_id = old.id;
END;
--> statement-breakpoint
INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'calendar', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT matter_event.id AS record_id, NULL AS container_id, matter_event.matter_id AS matter_id, matter_event.starts_on AS sort_key, matter_event.title AS title, matter_event.description AS body FROM `matter_event` WHERE 1 AND TRIM(COALESCE(matter_event.title, '') || COALESCE(matter_event.description, '')) <> '') AS derived;
--> statement-breakpoint
INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT matter_event.id AS record_id, NULL AS container_id, matter_event.matter_id AS matter_id, matter_event.starts_on AS sort_key, matter_event.title AS title, matter_event.description AS body FROM `matter_event` WHERE 1 AND TRIM(COALESCE(matter_event.title, '') || COALESCE(matter_event.description, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'calendar' AND entry.record_id = derived.record_id;
--> statement-breakpoint
CREATE TRIGGER `record_text_communications_insert` AFTER INSERT ON `communication` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'communications' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'communications' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'communications', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT communication.id AS record_id, NULL AS container_id, communication.matter_id AS matter_id, communication.occurred_at AS sort_key, NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), '') AS title, communication.body AS body FROM `communication` WHERE communication.id = new.id AND TRIM(COALESCE(NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), ''), '') || COALESCE(communication.body, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT communication.id AS record_id, NULL AS container_id, communication.matter_id AS matter_id, communication.occurred_at AS sort_key, NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), '') AS title, communication.body AS body FROM `communication` WHERE communication.id = new.id AND TRIM(COALESCE(NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), ''), '') || COALESCE(communication.body, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'communications' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_communications_update` AFTER UPDATE OF `matter_id`, `summary`, `caller_id_name`, `body`, `occurred_at` ON `communication` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'communications' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'communications' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'communications', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT communication.id AS record_id, NULL AS container_id, communication.matter_id AS matter_id, communication.occurred_at AS sort_key, NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), '') AS title, communication.body AS body FROM `communication` WHERE communication.id = new.id AND TRIM(COALESCE(NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), ''), '') || COALESCE(communication.body, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT communication.id AS record_id, NULL AS container_id, communication.matter_id AS matter_id, communication.occurred_at AS sort_key, NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), '') AS title, communication.body AS body FROM `communication` WHERE communication.id = new.id AND TRIM(COALESCE(NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), ''), '') || COALESCE(communication.body, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'communications' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_communications_delete` AFTER DELETE ON `communication` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'communications' AND record_id = old.id);
  DELETE FROM `record_text_entry` WHERE source = 'communications' AND record_id = old.id;
END;
--> statement-breakpoint
INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'communications', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT communication.id AS record_id, NULL AS container_id, communication.matter_id AS matter_id, communication.occurred_at AS sort_key, NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), '') AS title, communication.body AS body FROM `communication` WHERE 1 AND TRIM(COALESCE(NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), ''), '') || COALESCE(communication.body, '')) <> '') AS derived;
--> statement-breakpoint
INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT communication.id AS record_id, NULL AS container_id, communication.matter_id AS matter_id, communication.occurred_at AS sort_key, NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), '') AS title, communication.body AS body FROM `communication` WHERE 1 AND TRIM(COALESCE(NULLIF(TRIM(COALESCE(communication.summary, '') || ' ' || COALESCE(communication.caller_id_name, '')), ''), '') || COALESCE(communication.body, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'communications' AND entry.record_id = derived.record_id;
--> statement-breakpoint
CREATE TRIGGER `record_text_tasks_insert` AFTER INSERT ON `matter_task` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'tasks' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'tasks' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'tasks', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT matter_task.id AS record_id, NULL AS container_id, matter_task.matter_id AS matter_id, matter_task.created_at AS sort_key, matter_task.title AS title, matter_task.body AS body FROM `matter_task` WHERE matter_task.id = new.id AND TRIM(COALESCE(matter_task.title, '') || COALESCE(matter_task.body, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT matter_task.id AS record_id, NULL AS container_id, matter_task.matter_id AS matter_id, matter_task.created_at AS sort_key, matter_task.title AS title, matter_task.body AS body FROM `matter_task` WHERE matter_task.id = new.id AND TRIM(COALESCE(matter_task.title, '') || COALESCE(matter_task.body, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'tasks' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_tasks_update` AFTER UPDATE OF `matter_id`, `title`, `body` ON `matter_task` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'tasks' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'tasks' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'tasks', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT matter_task.id AS record_id, NULL AS container_id, matter_task.matter_id AS matter_id, matter_task.created_at AS sort_key, matter_task.title AS title, matter_task.body AS body FROM `matter_task` WHERE matter_task.id = new.id AND TRIM(COALESCE(matter_task.title, '') || COALESCE(matter_task.body, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT matter_task.id AS record_id, NULL AS container_id, matter_task.matter_id AS matter_id, matter_task.created_at AS sort_key, matter_task.title AS title, matter_task.body AS body FROM `matter_task` WHERE matter_task.id = new.id AND TRIM(COALESCE(matter_task.title, '') || COALESCE(matter_task.body, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'tasks' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_tasks_delete` AFTER DELETE ON `matter_task` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'tasks' AND record_id = old.id);
  DELETE FROM `record_text_entry` WHERE source = 'tasks' AND record_id = old.id;
END;
--> statement-breakpoint
INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'tasks', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT matter_task.id AS record_id, NULL AS container_id, matter_task.matter_id AS matter_id, matter_task.created_at AS sort_key, matter_task.title AS title, matter_task.body AS body FROM `matter_task` WHERE 1 AND TRIM(COALESCE(matter_task.title, '') || COALESCE(matter_task.body, '')) <> '') AS derived;
--> statement-breakpoint
INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT matter_task.id AS record_id, NULL AS container_id, matter_task.matter_id AS matter_id, matter_task.created_at AS sort_key, matter_task.title AS title, matter_task.body AS body FROM `matter_task` WHERE 1 AND TRIM(COALESCE(matter_task.title, '') || COALESCE(matter_task.body, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'tasks' AND entry.record_id = derived.record_id;
--> statement-breakpoint
CREATE TRIGGER `record_text_magnus_conversations_insert` AFTER INSERT ON `magnus_conversation` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'magnus-conversations' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'magnus-conversations' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'magnus-conversations', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT magnus_conversation.id AS record_id, NULL AS container_id, magnus_conversation.matter_id AS matter_id, magnus_conversation.created_at AS sort_key, magnus_conversation.title AS title, NULL AS body FROM `magnus_conversation` WHERE magnus_conversation.id = new.id AND (magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(magnus_conversation.title, '') || COALESCE(NULL, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT magnus_conversation.id AS record_id, NULL AS container_id, magnus_conversation.matter_id AS matter_id, magnus_conversation.created_at AS sort_key, magnus_conversation.title AS title, NULL AS body FROM `magnus_conversation` WHERE magnus_conversation.id = new.id AND (magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(magnus_conversation.title, '') || COALESCE(NULL, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'magnus-conversations' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_magnus_conversations_update` AFTER UPDATE OF `matter_id`, `title`, `deleted_at` ON `magnus_conversation` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'magnus-conversations' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'magnus-conversations' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'magnus-conversations', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT magnus_conversation.id AS record_id, NULL AS container_id, magnus_conversation.matter_id AS matter_id, magnus_conversation.created_at AS sort_key, magnus_conversation.title AS title, NULL AS body FROM `magnus_conversation` WHERE magnus_conversation.id = new.id AND (magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(magnus_conversation.title, '') || COALESCE(NULL, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT magnus_conversation.id AS record_id, NULL AS container_id, magnus_conversation.matter_id AS matter_id, magnus_conversation.created_at AS sort_key, magnus_conversation.title AS title, NULL AS body FROM `magnus_conversation` WHERE magnus_conversation.id = new.id AND (magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(magnus_conversation.title, '') || COALESCE(NULL, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'magnus-conversations' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_magnus_conversations_delete` AFTER DELETE ON `magnus_conversation` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'magnus-conversations' AND record_id = old.id);
  DELETE FROM `record_text_entry` WHERE source = 'magnus-conversations' AND record_id = old.id;
END;
--> statement-breakpoint
INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'magnus-conversations', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT magnus_conversation.id AS record_id, NULL AS container_id, magnus_conversation.matter_id AS matter_id, magnus_conversation.created_at AS sort_key, magnus_conversation.title AS title, NULL AS body FROM `magnus_conversation` WHERE 1 AND (magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(magnus_conversation.title, '') || COALESCE(NULL, '')) <> '') AS derived;
--> statement-breakpoint
INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT magnus_conversation.id AS record_id, NULL AS container_id, magnus_conversation.matter_id AS matter_id, magnus_conversation.created_at AS sort_key, magnus_conversation.title AS title, NULL AS body FROM `magnus_conversation` WHERE 1 AND (magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(magnus_conversation.title, '') || COALESCE(NULL, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'magnus-conversations' AND entry.record_id = derived.record_id;
--> statement-breakpoint
CREATE TRIGGER `record_text_magnus_turns_insert` AFTER INSERT ON `magnus_turn` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'magnus-turns' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'magnus-turns' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'magnus-turns', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT magnus_turn.id AS record_id, magnus_turn.conversation_id AS container_id, magnus_conversation.matter_id AS matter_id, magnus_turn.created_at AS sort_key, NULL AS title, magnus_turn.content AS body FROM `magnus_turn` JOIN `magnus_conversation` ON magnus_conversation.id = magnus_turn.conversation_id WHERE magnus_turn.id = new.id AND (magnus_turn.status = 'complete' AND magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(NULL, '') || COALESCE(magnus_turn.content, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT magnus_turn.id AS record_id, magnus_turn.conversation_id AS container_id, magnus_conversation.matter_id AS matter_id, magnus_turn.created_at AS sort_key, NULL AS title, magnus_turn.content AS body FROM `magnus_turn` JOIN `magnus_conversation` ON magnus_conversation.id = magnus_turn.conversation_id WHERE magnus_turn.id = new.id AND (magnus_turn.status = 'complete' AND magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(NULL, '') || COALESCE(magnus_turn.content, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'magnus-turns' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_magnus_turns_update` AFTER UPDATE OF `content`, `status` ON `magnus_turn` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'magnus-turns' AND record_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'magnus-turns' AND record_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'magnus-turns', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT magnus_turn.id AS record_id, magnus_turn.conversation_id AS container_id, magnus_conversation.matter_id AS matter_id, magnus_turn.created_at AS sort_key, NULL AS title, magnus_turn.content AS body FROM `magnus_turn` JOIN `magnus_conversation` ON magnus_conversation.id = magnus_turn.conversation_id WHERE magnus_turn.id = new.id AND (magnus_turn.status = 'complete' AND magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(NULL, '') || COALESCE(magnus_turn.content, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT magnus_turn.id AS record_id, magnus_turn.conversation_id AS container_id, magnus_conversation.matter_id AS matter_id, magnus_turn.created_at AS sort_key, NULL AS title, magnus_turn.content AS body FROM `magnus_turn` JOIN `magnus_conversation` ON magnus_conversation.id = magnus_turn.conversation_id WHERE magnus_turn.id = new.id AND (magnus_turn.status = 'complete' AND magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(NULL, '') || COALESCE(magnus_turn.content, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'magnus-turns' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_magnus_turns_delete` AFTER DELETE ON `magnus_turn` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'magnus-turns' AND record_id = old.id);
  DELETE FROM `record_text_entry` WHERE source = 'magnus-turns' AND record_id = old.id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_magnus_turns_container_update` AFTER UPDATE OF `matter_id`, `deleted_at` ON `magnus_conversation` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'magnus-turns' AND container_id = new.id);
  DELETE FROM `record_text_entry` WHERE source = 'magnus-turns' AND container_id = new.id;
  INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'magnus-turns', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT magnus_turn.id AS record_id, magnus_turn.conversation_id AS container_id, magnus_conversation.matter_id AS matter_id, magnus_turn.created_at AS sort_key, NULL AS title, magnus_turn.content AS body FROM `magnus_turn` JOIN `magnus_conversation` ON magnus_conversation.id = magnus_turn.conversation_id WHERE magnus_turn.conversation_id = new.id AND (magnus_turn.status = 'complete' AND magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(NULL, '') || COALESCE(magnus_turn.content, '')) <> '') AS derived;
  INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT magnus_turn.id AS record_id, magnus_turn.conversation_id AS container_id, magnus_conversation.matter_id AS matter_id, magnus_turn.created_at AS sort_key, NULL AS title, magnus_turn.content AS body FROM `magnus_turn` JOIN `magnus_conversation` ON magnus_conversation.id = magnus_turn.conversation_id WHERE magnus_turn.conversation_id = new.id AND (magnus_turn.status = 'complete' AND magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(NULL, '') || COALESCE(magnus_turn.content, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'magnus-turns' AND entry.record_id = derived.record_id;
END;
--> statement-breakpoint
CREATE TRIGGER `record_text_magnus_turns_container_delete` AFTER DELETE ON `magnus_conversation` BEGIN
  DELETE FROM `record_text_fts` WHERE rowid IN (SELECT id FROM `record_text_entry` WHERE source = 'magnus-turns' AND container_id = old.id);
  DELETE FROM `record_text_entry` WHERE source = 'magnus-turns' AND container_id = old.id;
END;
--> statement-breakpoint
INSERT INTO `record_text_entry` (source, record_id, container_id, matter_id, sort_key) SELECT 'magnus-turns', derived.record_id, derived.container_id, derived.matter_id, derived.sort_key FROM (SELECT magnus_turn.id AS record_id, magnus_turn.conversation_id AS container_id, magnus_conversation.matter_id AS matter_id, magnus_turn.created_at AS sort_key, NULL AS title, magnus_turn.content AS body FROM `magnus_turn` JOIN `magnus_conversation` ON magnus_conversation.id = magnus_turn.conversation_id WHERE 1 AND (magnus_turn.status = 'complete' AND magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(NULL, '') || COALESCE(magnus_turn.content, '')) <> '') AS derived;
--> statement-breakpoint
INSERT INTO `record_text_fts` (rowid, scope, title, body) SELECT entry.id, CASE WHEN entry.matter_id IS NULL THEN 'nomatter' ELSE 'm' || lower(hex(entry.matter_id)) END, derived.title, derived.body FROM (SELECT magnus_turn.id AS record_id, magnus_turn.conversation_id AS container_id, magnus_conversation.matter_id AS matter_id, magnus_turn.created_at AS sort_key, NULL AS title, magnus_turn.content AS body FROM `magnus_turn` JOIN `magnus_conversation` ON magnus_conversation.id = magnus_turn.conversation_id WHERE 1 AND (magnus_turn.status = 'complete' AND magnus_conversation.deleted_at IS NULL) AND TRIM(COALESCE(NULL, '') || COALESCE(magnus_turn.content, '')) <> '') AS derived JOIN `record_text_entry` AS entry ON entry.source = 'magnus-turns' AND entry.record_id = derived.record_id;
