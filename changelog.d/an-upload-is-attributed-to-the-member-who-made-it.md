---
category: Fixed
audience: public
---

**Created By is no longer blank.** The file table's Created By column read from a resolver that
returned the empty string for every file (`file-manager.svelte`), because the file summary carried
no uploader at all — `file_version.uploaded_by` was written at reserve and never read back. The
list, the single-file read and the version history now project `uploaded_by` with the member's
display name off a `LEFT JOIN member` (`uploadedBy` / `uploadedByName` on `FileSummary` and
`FileVersionItem`); the column reads the name, the inspector gains a Created By row, and a departed
member's uploads keep their id and lose only the name.

## Public

**Files now say who created them.** The Created By column in the file list, and a Created By line in
a file's details, show the member who uploaded the file. A file uploaded before this change shows
its uploader too; a file whose uploader has since left the firm shows no name rather than a wrong one.
