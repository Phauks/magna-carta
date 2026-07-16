---
number: 175
slug: file-list-ingest-status
status: Accepted
date: 2026-07-09
area: Core domain / File Manager
summary: Expose ingest outcome on files.list rather than a separate quarantine route — files.list gains an opt-in includePendingAndQuarantined flag and FileSummary gains status + quarantineReason, while currentVersionId stays clean-only. The clean-only download gate is not weakened: every read path independently carries its own status = 'clean' predicate, and current_version_id only ever advances to a clean version, so a pending or quarantined first upload carries currentVersionId null and structurally cannot render a download link. A separate /matters/{id}/quarantine route was rejected because it puts the answer on a page nobody opens.
---

**Ingest outcome belongs in the file list, not a separate quarantine page.** After an upload completes, its first version is `pending` until the async ingest queue commits or quarantines it. Until now no endpoint projected that outcome: `files.list` gated on `current_version_id IS NOT NULL`, `files.get` 404ed a pending-only file, and there was no upload-status read — so a file the scanner flagged as malware simply never appeared, with no message to the person who dropped it. This decision surfaces the outcome where the work happened.

**Decision.** `files.list` gains an opt-in `includePendingAndQuarantined` query flag. With it set, the list also returns files whose latest version is still `pending` (ingest in flight) or was `quarantined` (rejected as malware); by default the historical behaviour holds — only files with a committed clean version appear, soft-deleted files always excluded. `FileSummary` (shared by `files.list` and `files.get`) gains `status` (`clean | pending | quarantined`) and `quarantineReason` (the scan detail, present only when quarantined), alongside the display-version enrichment (`versionNumber`, `sizeBytes`, `sniffedContentType`, `scanVerdict`) that lets one list call paint a file table with no per-row fan-out to the version history. A companion `GET /api/v1/uploads/{id}` reports the same version status keyed by the upload session, for the post-upload poll. **`currentVersionId` stays clean-only** in every mode — it is projected from the file row's clean pointer, never from the joined display version.

**Why the clean-only gate is not weakened.** Surfacing a quarantined row in a list does not make its bytes reachable, because the download and preview gate is not the list query — every servable read path independently carries its own `status = 'clean'` predicate:

- `getCurrentCleanVersion` / `selectCurrentCleanVersionStatement` — the signed-download path.
- `getCurrentCleanVersionForPreview` / `selectCurrentCleanVersionForPreviewStatement` — the inline-preview gate.
- `listCleanVersions` / `listCleanVersionsStatement` — the version-history read.
- `listCleanCurrentVersionsByMatter` / `listCleanCurrentVersionsByMatterStatement` — the ZIP bulk-download selection.
- `getFileWithCurrentCleanVersion` — the latency-sensitive edit/view launch and every WOPI `CheckFileInfo` callback (a `LEFT JOIN … AND v.status = 'clean'`).

The quarantine gate is a status gate enforced redundantly at each consumer, as `packages/file-manager/CLAUDE.md` requires; the list read adds a sixth consumer that projects status for display and reaches no bytes. The display-version resolution in the include mode targets a version gated to `pending`/`quarantined` in a `COALESCE` subquery, and the projected `currentVersionId` still comes from the clean pointer alone.

**Why a rejected row cannot render a download link.** The guarantee is structural, not a rule a future contributor must remember. Exactly one live statement advances `current_version_id` to a non-null value: `bumpFileCurrentVersionStatement`, whose four callers in `file-service.ts` each pair it with a clean commit of the same version. Reconciling a diverged copy does not bypass this — it routes through `restoreVersion`, which cuts a fresh clean version and then bumps.

A pending or quarantined first upload is therefore never pointed at, and its `currentVersionId` is `null` — there is nothing to link to, in any list mode. A row can announce "rejected"; it cannot offer the bytes.

`setFileCurrentVersionStatement` also exists in `file-statements.ts` and would set the pointer *unconditionally*, with no status predicate. It has no callers anywhere in the repository. It is dead code and a latent hazard: wiring it up would break the guarantee above. It should be deleted, or gated on `status = 'clean'`, before any caller is added.

**Considered and rejected: a separate `/matters/{id}/quarantine` route.** It would answer "did my upload get rejected?" on a page nobody opens. A rejected file must say so where the user dropped it — inline in the folder they uploaded into — so the answer was folded into the list the user is already looking at, behind an explicit opt-in, rather than exiled to a quarantine console. This keeps one file surface, not two, and no client has to reconcile a file's presence in a list against its absence-plus-a-separate-feed.

**Consequences.** A client paints a live file table, including in-flight and rejected uploads, from one list call plus one status poll, with no weakening of the download gate and no new page. Deferred: the `apps/web` Files surface that consumes this (its own stream), and the `file.quarantined` outbox consumer that will drive a notification rather than the poll. Upholds the quarantine status-gate invariant in `packages/file-manager/CLAUDE.md`.
