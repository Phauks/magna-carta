-- The search-index catalog's scope key widens from a matter to a CORPUS.
--
-- Every other part of the widening already shipped: the corpus type, the derived split object key, and
-- the port's three operations all take a corpus. The catalog did not, and it is the half that decides
-- disclosure — a query enumerates its splits from these rows, so while the only scope column is
-- `matter_id`, a discovery review set indexed under its matter would put material an opposing party
-- produced into the result set of an ordinary matter search. Under a protective order that is not a
-- cache miss.
--
-- Hand-written rather than drizzle-kit-generated because of the backfill in the middle: drizzle-kit
-- emits the column adds and the index, and cannot emit the UPDATE that gives the rows already in the
-- table their corpus. Column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
--
-- ADDITIVE, and `matter_id` stays. It is provenance from here on — which matter the index work was done
-- under — and nothing enumerates a corpus by it. Dropping it would be a rebuild of a table firms have
-- already provisioned, to reclaim one column on a catalog of a derived cache.
ALTER TABLE `index_split` ADD `corpus_kind` text DEFAULT 'matter' NOT NULL;--> statement-breakpoint
ALTER TABLE `index_split` ADD `corpus_id` text;--> statement-breakpoint
-- Every row that exists today was published under the identity mapping from a matter to its own corpus,
-- so its corpus IS its matter and the backfill is exact rather than a guess. (At the time of writing no
-- firm has published a split at all — the index engine is not deployed — so this updates nothing; it is
-- here because a migration that only works on an empty table is one that fails the first time it does
-- not run on one.)
UPDATE `index_split` SET `corpus_id` = `matter_id` WHERE `corpus_id` IS NULL;--> statement-breakpoint
CREATE INDEX `index_split_corpus_superseded_index` ON `index_split` (`corpus_id`,`superseded_at`,`created_at`);
--> statement-breakpoint
-- And what a review document's own row says about its place in the index.
--
-- A document the index engine has not reached is not an exception: the exception vocabulary is a closed
-- list of sentences about what could not be READ, every one of them rendered into a report a firm hands
-- to another party, and "our search index has not caught up" is not one of them. It is the same
-- distinction `processing_deferred_reason` already draws one stage earlier, kept in a separate pair of
-- columns because the two stages fail for different reasons and a reader must not have to guess which
-- stage a reason came from.
--
-- Nullable and unconstrained: SQLite cannot add a CHECK after the fact, so the closed vocabulary is held
-- by the one statement that writes these columns and by the test beside it.
ALTER TABLE `review_document` ADD `index_state` text;--> statement-breakpoint
ALTER TABLE `review_document` ADD `index_deferred_reason` text;--> statement-breakpoint
-- "What is this corpus still owed by the index" as one indexed read over the review set, rather than an
-- anti-join between a quarter-million review documents and the split catalog.
CREATE INDEX `review_document_index_state_index` ON `review_document` (`review_set_id`,`index_state`);
--> statement-breakpoint
-- The review-document LIST page, which is the read the whole review surface pages through.
--
-- It is ordered newest-document-first and keyset-paged on (sort_date, id), and every filter a reviewer
-- actually uses narrows it. An index that stops at the filter column would satisfy the WHERE and leave
-- the ORDER BY to a temporary b-tree over a quarter-million rows on every page — which is the shape
-- that looks fast on a demo corpus and falls over on a real production. So each filtered form of the
-- read gets the sort columns on the end of its own index.
--
-- The narrower (review_set_id, record_custodian_id) and (review_set_id, processing_state) indexes stay:
-- they are prefixes of these and now redundant, and dropping one is a rebuild of a table firms have
-- already provisioned.
CREATE INDEX `review_document_review_set_page_index` ON `review_document` (`review_set_id`,`sort_date`,`id`,`processing_state`);--> statement-breakpoint
CREATE INDEX `review_document_custodian_page_index` ON `review_document` (`review_set_id`,`record_custodian_id`,`sort_date`,`id`);--> statement-breakpoint
CREATE INDEX `review_document_load_page_index` ON `review_document` (`review_set_id`,`discovery_load_id`,`sort_date`,`id`);--> statement-breakpoint
CREATE INDEX `review_document_state_page_index` ON `review_document` (`review_set_id`,`processing_state`,`sort_date`,`id`);--> statement-breakpoint
-- The exception REPORT read: one review set's exceptions, keyset-paged on the (document, exception)
-- pair. The shipped (review_set_id, code) index serves the counts-by-code group-by; this serves the
-- walk, which the report and the live read both make and which pages by the pair because several
-- reasons on one document is normal.
CREATE INDEX `review_document_exception_review_set_page_index` ON `review_document_exception` (`review_set_id`,`review_document_id`,`id`);
--> statement-breakpoint
-- The occurrence panel's read with the order it is served in on the end, so one document's copies come
-- back sorted from the index rather than through a temporary b-tree.
CREATE INDEX `review_document_occurrence_primary_page_index` ON `review_document_occurrence` (`review_set_id`,`primary_review_document_id`,`duplicate_review_document_id`);
