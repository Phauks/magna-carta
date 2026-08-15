-- What an assembly job was asked to produce. The merge itself always emits a word-processing package;
-- `pdf` asks the job to carry that package across the office-suite conversion edge before filing it.
-- Recorded on the provenance row rather than inferred from the filed object, because a job that failed
-- still has to say what it was trying to make. Purely additive, so the table is not rebuilt. Column
-- comments live beside the Drizzle definitions in packages/database/src/per-firm-schema.ts.
--
-- The closed set rides the column as a CHECK: there is no ALTER TABLE ADD CONSTRAINT in SQLite, and a
-- column CHECK on the ADD is the one place the constraint can be stated without rewriting the table.
-- Every existing row takes the default, which the constraint accepts.
ALTER TABLE `document_assembly` ADD COLUMN `output_format` text DEFAULT 'docx' NOT NULL CONSTRAINT `document_assembly_output_format_check` CHECK (`output_format` IN ('docx', 'pdf'));
