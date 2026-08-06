-- The merge-field binding index: which registered template versions bind which merge keys.
--
-- Hand-written rather than drizzle-kit-generated because the table has no surrogate key — its identity
-- is the (version, key) pair — and because the second index is deliberately covering in the other
-- direction. Table and column comments live beside the Drizzle definitions in
-- packages/database/src/per-firm-schema.ts.
--
-- The rows are DERIVED FROM AN IMMUTABLE ROW AND WRITTEN IN THE SAME BATCH AS IT. A template version's
-- bytes, its manifest, and therefore its bindings never change after registration, so there is no
-- update path here, no reconciliation, and no way for these rows to disagree with the manifest they
-- came from. That is what makes an index acceptable where the alternative was a scan with `instr()`
-- over every stored manifest.
CREATE TABLE `document_template_field_binding` (
	`template_version_id` text NOT NULL,
	`merge_key` text NOT NULL,
	PRIMARY KEY(`template_version_id`, `merge_key`),
	FOREIGN KEY (`template_version_id`) REFERENCES `document_template_version`(`id`),
	CONSTRAINT `document_template_field_binding_merge_key_nonempty_check` CHECK (length(`merge_key`) > 0)
);
--> statement-breakpoint
-- "Who binds this field" — the question an administrator asks before deprecating a key, the question
-- the picker's usage ordering aggregates, and the question the custom-field hard-delete guard asks
-- before destroying a definition. Leading with `merge_key` is what makes all three an index seek; the
-- version rides along so the answer never leaves the index.
CREATE INDEX `document_template_field_binding_merge_key_index` ON `document_template_field_binding` (`merge_key`,`template_version_id`);
