---
category: Fixed
---

- **Editing (WOPI):** the two file-access callbacks now agree on what a token may reach. `GetFile`
  re-checks the file and the version the token names on every call, so a soft-deleted file, a version
  withdrawn by the custody check, or a version a re-scan has flagged is refused rather than streamed
  under a still-valid token — the same answer `CheckFileInfo` already gave. `CheckFileInfo` also
  reports the **token's** version size and identifier instead of the file's current version, so a
  version cut by another writer mid-session no longer makes the advertised metadata describe different
  bytes than the ones served.
- **Matters:** a retried `open` or `reopen` carrying the same `Idempotency-Key` now replays its stored
  response instead of being refused by the precondition its own first attempt satisfied. Close already
  behaved this way; a genuinely new request, which carries its own key, is still refused.
- **File manager:** a version left `pending` by a dead-lettered ingest — the upload finished, the
  session closed, and nothing was left to commit it — is now detected on the daily pass and re-driven
  through the ingest path, with an operator counter for the rate.
- **File manager:** the folder-move cycle check is carried inside the `UPDATE`, so two concurrent
  cross moves can no longer commit a parent cycle that permanently detaches a subtree.
- **File manager:** a blank or whitespace-only folder or file name is refused with its own code and a
  422, instead of a misleading "name taken" on create or a raw constraint failure on rename.
- **File manager:** a version-lifecycle batch (commit, check-in, no-op skip, quarantine) now fails as
  a unit when its guarded status change loses a race, rather than committing the meter delta,
  current-version pointer move, session flip, audit row, and outbox event for a change that never
  happened.
