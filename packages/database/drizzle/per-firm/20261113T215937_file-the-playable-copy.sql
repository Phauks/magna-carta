-- THE PLAYABLE COPY IS FILED BESIDE THE ORIGINAL.
--
-- A copy of a video that every browser plays used to live only as an object beside the version's
-- own bytes, reachable through the player and nowhere else. It is now saved into the matter as a file
-- of its own, in the original's folder, so it can be opened, shared and exported like any other
-- document. This column points the original's version at that file. Null on every version made before
-- it and on every version nobody asked about, which is what makes this additive.
--
-- ADD COLUMN, NOT A REBUILD: `file_version` is a parent table (packages/database/CLAUDE.md).
ALTER TABLE `file_version` ADD `playable_copy_file_id` text;
