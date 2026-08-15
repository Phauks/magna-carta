-- Discovery processing: what read a document, how much of it a machine read, and why one that has
-- not been read yet is still waiting. Purely additive — three columns and one index, no table
-- rebuilt. Column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
--
-- WHY THE ROUTE IS RECORDED AT ALL. Extraction is composite: a born-digital page is read from the
-- document's own text layer, a scanned page is a recognizer's reading of a picture of one, and a 1997
-- binary office file is converted before either can look at it. Those are three different kinds of
-- evidence, and a corpus that recorded only the resulting text could not tell them apart. A firm
-- asked, under oath, how it read a production has to be able to name the engine; a reviewer deciding
-- how much to trust a search hit has to know whether the words are the ones the author typed.
-- No CHECK: the value is an ordered, comma-joined list drawn from a closed vocabulary, and a
-- constraint over its combinations would be a regex nobody could read. The vocabulary lives in
-- packages/search/src/extraction.ts and the write path in
-- packages/discovery/src/processing-statements.ts, which never writes a processed row without one.
ALTER TABLE `review_document` ADD COLUMN `extraction_route` text;--> statement-breakpoint
-- How many of the document's pages came back from recognition rather than from its own text layer.
-- A scalar beside the route because it is the number a reviewer judges the text by, and because
-- "which of these documents are scans" is a filter over the corpus rather than a fact about one page.
ALTER TABLE `review_document` ADD COLUMN `pages_recognized` integer CONSTRAINT `review_document_pages_recognized_check` CHECK (`pages_recognized` IS NULL OR `pages_recognized` >= 0);--> statement-breakpoint
-- WHY A DOCUMENT IS STILL PENDING. An engine that is not deployed, or a service that did not answer,
-- is not a verdict on the document — so it stays `pending` rather than being recorded `excepted`,
-- which would say the platform tried and the document could not be read. Without this column the
-- distinction between "not started" and "started, and the engine was not there" lives only in a queue
-- somebody has to know to look in; with it, what a review set is still owed is one indexed read over
-- the corpus itself. Cleared on the next attempt, so it is never stale.
ALTER TABLE `review_document` ADD COLUMN `processing_deferred_reason` text;--> statement-breakpoint
-- The dispatch walk: the documents of one load that still need processing, keyset-paged by id. The
-- shipped `(review_set_id, discovery_load_id)` index cannot serve it — at the ceiling a load IS the
-- review set, so that index narrows nothing and the state filter becomes a scan of a quarter-million
-- rows on every turn of a walk that has hundreds of turns. Leading with the load rather than the
-- review set for the same reason: this is the one discovery read whose scope is the load.
CREATE INDEX `review_document_load_state_index` ON `review_document` (`discovery_load_id`,`processing_state`,`id`);
