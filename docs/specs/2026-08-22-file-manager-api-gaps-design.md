# Four gaps between the File Manager API and a file-manager screen — design

**Date:** 2026-08-22
**Status:** Design proposed. No product code in this cycle. Five owner flags in section 8; three of the four gaps can be built without answering any of them.

**Owner-flag series: `FM`.** Its own letter series so an answer here can never be mistaken for an answer to a billing (`B`), trust (`T`), payments (`K`), notifications (`N`), intake (`J`), discovery (`P`), automations (`M`), general-ledger (`G`) or SPA-split (`W`) flag.

**Scope.** Four contract gaps found while designing a file-manager screen against the existing API: `files.list` cannot be sorted; there is no restore route and no deleted-files listing; the scan detail a version carries is not on the wire; version history carries no author. Out of scope: the screen itself, ADR-0049's trash-expiry and destruction machinery, and any change to how bytes are stored, scanned, or served.

**Every claim below was re-verified against the tree at `origin/claude/worker-decoupling`.** Two of the reported sub-problems turned out not to exist, one turned out to be the opposite of what was reported, and one turned out to be already-shipped exposure rather than a missing field. Those are recorded as findings, not quietly designed around.

---

## 1. What is actually true today

### 1.1 The listing sorts one way and the sort is a literal in the SQL

`listFilesStatement` builds its `WHERE` from an accumulator and then concatenates a fixed tail:

- [`packages/file-manager/src/queries.ts:159`](../../packages/file-manager/src/queries.ts) — `ORDER BY f.created_at DESC, f.id DESC LIMIT ?`, a literal in the template string with no parameter reaching it.
- [`packages/file-manager/src/queries.ts:143-148`](../../packages/file-manager/src/queries.ts) — the keyset predicate is hand-written as `(f.created_at < ? OR (f.created_at = ? AND f.id < ?))` rather than composed, because the join to `file_version` makes bare `created_at`/`id` ambiguous and the shared `appendCursorPredicate` emits unqualified columns.
- [`packages/file-manager/src/queries.ts:164-167`](../../packages/file-manager/src/queries.ts) — `ListFilesParams` extends the filters with `cursor` and `pageSize` and nothing else.
- [`apps/api-worker/src/routes/files.ts:289-296`](../../apps/api-worker/src/routes/files.ts) — the query schema is `matterId`, `folderId`, `cursor`, `pageSize` (`.max(200)`), `includePendingAndQuarantined`. No sort parameter, and the handler passes no sort through.

**Confirmed.** A column-sortable table built on this can only sort the rows it already holds.

**One qualification on the reported harm.** `pageSize` caps a _page_, not the corpus — a caller can walk a whole matter by cursor. What is dishonest is not the cap but the client-side sort: sorting one page of at most 200 rows and labelling the column header "Name" tells the user the table is sorted by name when it is sorted by name _within_ an arbitrary slice of creation order. Server-side sort is the fix; the cap needs no change.

**No API surface anywhere in this Worker takes a caller-selected sort.** A scan of `apps/api-worker/src/routes/` for `sort:`/`sortBy`/`order:` query fields finds one hit, and it is an unrelated response field (`templates.ts:490`). This design therefore sets the platform's first sort-parameter precedent, and section 4 states the shape so the second one has something to copy.

### 1.2 The restore path exists in the domain and is reachable from nothing

- [`packages/file-manager/src/file-service.ts:1041-1056`](../../packages/file-manager/src/file-service.ts) — `restoreFile` composes `restoreFileStatement` plus a `file.restored` audit row.
- [`packages/file-manager/src/file-service.ts:105-111`](../../packages/file-manager/src/file-service.ts) — `requireFileIncludingDeleted`, the one resolver that returns a soft-deleted row, exists for exactly this caller.
- A repository-wide search for `restoreFile`, `requireFileIncludingDeleted` and `includeDeleted` returns five files: three in `packages/file-manager/src`, two in `packages/file-manager/test`. **No route, no handler, no client.**

**Confirmed.** There is no way to undelete a file through the API, and no way to see what has been deleted.

The domain half of the _listing_ is further along than the routes are, and further from sufficient than it looks:

- [`packages/file-manager/src/queries.ts:32`](../../packages/file-manager/src/queries.ts) — `ListFilesFilters.includeDeleted?: boolean`, commented "the recovery view; default false". It is wired into `listFilesStatement` and it works.
- But it _includes_ deleted rows alongside live ones; there is no deleted-only mode.
- And [`packages/file-manager/src/queries.ts:47-64`](../../packages/file-manager/src/queries.ts) — `FileListItem` carries no `deletedAt`, and `FILE_SUMMARY_COLUMNS` does not select `f.deleted_at`. A caller passing `includeDeleted: true` gets a mixed list it cannot separate.

**The feature ledger overstates this.** [`roadmap.d/documents.md:310-315`](../../roadmap.d/documents.md) records `documents.versioning.deleted-lifecycle.trash` as `status: shipped`, `surface: awaiting-screen`, on the evidence of the statements existing. A capability reachable from no route is not shipped and its blocker is not a missing screen. The node should read `partial`; that edit belongs to whoever next touches the ledger, not to this branch (`claude/passive-dev-orchestrator-m7f9jw` holds it).

### 1.3 The listing reports a verdict and cannot report why — and already leaks more than it should

- [`apps/api-worker/src/routes/files.ts:86-89`](../../apps/api-worker/src/routes/files.ts) — `FileSummary` carries `scanVerdict` (`unscanned | clean | flagged | null`) and `quarantineReason` (`string | null`).
- [`packages/file-manager/src/queries.ts:104`](../../packages/file-manager/src/queries.ts) — `quarantineReason` is `row.scan_detail`, projected **only** when the display version's status is `quarantined`, and null otherwise.

So an `unscanned` row cannot say whether it is oversize, encrypted, or engine-less, and a `clean` row cannot show the active-content badge the package deliberately records. **Confirmed.**

**What is not in the report, and changes the whole shape of the answer: the raw malware signature already crosses this route.**

- [`packages/file-manager/src/verdict.ts:28-39`](../../packages/file-manager/src/verdict.ts) — `scanDetailFor` returns `"active-content"` or null for `clean`, the reason for `unscanned`, and the reason for `flagged`.
- [`packages/file-manager/src/verdict.ts:59-74`](../../packages/file-manager/src/verdict.ts) — a `flagged` verdict's `reason` is `raw.clam.signature` (engine-supplied free text), else a YARA `ruleId`, else a structural-heuristic token.
- [`packages/file-manager/src/file-service.ts:876`](../../packages/file-manager/src/file-service.ts) — `quarantineVersion` writes `scan_detail = input.scanDetail ?? input.reason`.
- [`packages/file-manager/src/ingest-core.ts:274`](../../packages/file-manager/src/ingest-core.ts) — a `scan-flagged` quarantine passes `scanDetail: fileVerdict.reason`, i.e. the signature.

Therefore `FileSummary.quarantineReason` today returns **either** a closed quarantine-reason token (`size-mismatch`, `type-mismatch`, `policy-size`, `policy-type`) **or** a raw ClamAV signature name, in one untagged string, on a route whose `RouteMeta` is `permission: null, audited: false` ([`files.ts:188-197`](../../apps/api-worker/src/routes/files.ts)). A client cannot tell which it received, so it cannot render "rejected: file type not allowed" differently from "rejected: `Win.Trojan.Foo-1234`".

The download path also carries it, deliberately and audited: [`files.ts:816`](../../apps/api-worker/src/routes/files.ts) (403 under `block` treatment) and [`files.ts:832`](../../apps/api-worker/src/routes/files.ts) (409 under `informed-access`) both interpolate `version.scanDetail` into the problem `detail`. The reported claim that "the flagged signature does arrive in the download 409's detail" is confirmed at those two lines.

And the raw string is already a **cross-firm telemetry dimension**: [`packages/telemetry/src/events.ts:87-92`](../../packages/telemetry/src/events.ts) defines `ingest.verdict` with a `scanDetail` slot, and [`apps/api-worker/src/files/ingest-consumer.ts:228-243`](../../apps/api-worker/src/files/ingest-consumer.ts) passes `outcome.scanDetail` into it unmodified.

**The platform has already answered the question the report asks, twice, and one of the answers is wrong.** Section 6 proposes a design that _reduces_ what the listing exposes rather than adding to it.

### 1.4 Version history carries no author, and the column it needs already exists

- [`apps/api-worker/src/routes/files.ts:97-106`](../../apps/api-worker/src/routes/files.ts) — `FileVersionItem` is `id`, `versionNumber`, `sizeBytes`, `sniffedContentType`, `contentSha256`, `committedAt`.
- [`packages/file-manager/src/queries.ts:614`](../../packages/file-manager/src/queries.ts) — `listCleanVersionsStatement` selects those six columns and stops.

**Confirmed.** But the reported open question — "whether the underlying column even exists, or whether this needs a migration" — resolves cleanly:

- [`packages/database/src/per-firm-schema.ts:904`](../../packages/database/src/per-firm-schema.ts) — `uploadedBy: text("uploaded_by").$type<UserId>()`, with the comment "not an FK — the upload fact outlives the member row".
- [`packages/database/drizzle/per-firm/20260704T041516_baseline.sql:385`](../../packages/database/drizzle/per-firm/20260704T041516_baseline.sql) — `` `uploaded_by` text ``, present since the baseline.
- [`packages/file-manager/src/file-statements.ts:84`](../../packages/file-manager/src/file-statements.ts) — the commit statement writes it.

**No migration.** This is a projection and a wire field.

## 2. What the report got wrong

Two of gap 2's stated questions describe hazards that cannot occur, and one of gap 4's stated preferences is backwards. Recording them here so nobody designs against them again.

**"What happens when a folder that held them is gone" — a folder holding a soft-deleted file cannot be deleted.** [`packages/file-manager/src/file-statements.ts:620-624`](../../packages/file-manager/src/file-statements.ts): `selectFolderFileStatement` is `SELECT id FROM file WHERE folder_id = ?1 LIMIT 1` with **no `deleted_at` filter**, and [`packages/file-manager/src/folder-service.ts:209-215`](../../packages/file-manager/src/folder-service.ts) refuses the delete when it returns a row. The comment at [`file-statements.ts:102-103`](../../packages/file-manager/src/file-statements.ts) says so outright: "a folder holding deleted files is not 'empty' enough to drop". A soft-deleted file also cannot be moved out from under itself — every mutation resolves through `requireLiveFile` ([`file-service.ts:119-125`](../../packages/file-manager/src/file-service.ts)). So a restore always finds its folder exactly where the delete left it. Nothing to design. The `deleted_at`-blindness of that emptiness check is load-bearing for restore and reads like an oversight, so the restore work should add a test naming the coupling.

**"Whether a restore collides with a name now taken" — files have no name-uniqueness concept at all.** The sibling-name unique index is on `folder` ([`per-firm-schema.ts:803-805`](../../packages/database/src/per-firm-schema.ts)), not on `file`; the `file` table's constraint list ([`per-firm-schema.ts:853-859`](../../packages/database/src/per-firm-schema.ts)) is two indexes and two CHECKs, none about names. `FileManagerValidationError` carries `folder-name-taken` and `document-type-name-taken` and no file equivalent ([`packages/file-manager/src/validation.ts:10,36`](../../packages/file-manager/src/validation.ts)). Two files with the same name in one folder is already reachable by ordinary upload. A restore cannot collide with anything, and inventing a refusal here would make undelete stricter than upload.

**"A user identifier the client resolves separately may be better than an embedded name" — there is nothing to resolve against.** The only `members.*` operations in the contract are `members.invite` ([`apps/api-worker/src/routes/members.ts:49`](../../apps/api-worker/src/routes/members.ts)) and `members.professionalProfile` / `members.setProfessionalProfile` ([`apps/api-worker/src/routes/member-profiles.ts:66,83`](../../apps/api-worker/src/routes/member-profiles.ts)), the latter being one member's own profile. **No route lists the firm's members or maps a user identifier to a display name.** An identifier-only field would be a field the client cannot render, and recommending "the client resolves it separately" would be recommending a resolver that does not exist. Section 7 takes the other branch, with a precedent.

## 3. What the report was right to worry about, and what governs it

Two questions the report raised do bind, and their homes are not where the report pointed.

**Scan detail and the invariants.** [`docs/conventions/invariants.md`](../conventions/invariants.md) has no File Manager rule about response content — its File Manager section (lines 30-32) is the quarantine status gate, version immutability, and opaque R2 keys, and its redaction rules (line 51) are about SSRF investigation targets. The rule that actually binds is **golden rule 4** in the root [`CLAUDE.md`](../../CLAUDE.md): redact by default, never log privileged content. A scan reason token is not privileged content. An engine-supplied signature name is a fact about the bytes rather than a fact from them, which is why the platform already treats it as safe enough for an audited refusal and — less defensibly — for a cross-firm telemetry dimension. Section 6 splits the two and flags the residue.

**Custodian and discovery retention.** Custodian is the only subsystem holding a concept that a deleted-file design must not contradict, and it holds it precisely:

- [`packages/custodian/src/hold-statements.ts:132-160`](../../packages/custodian/src/hold-statements.ts) — `selectActiveCustodyHoldsForFileStatement` / `readActiveCustodyHoldsForFile`, whose comment names its purpose exactly: "the blocker a destruction path calls before removing a stored file… This is the read that makes the deleted-file lifecycle's 'blocked by a Custodian hold' arm real rather than nominal." It is called by **no product code** — only by `packages/custodian/test/hold-and-scan.test.ts`.
- [`packages/custodian/src/destruction-service.ts:49-51`](../../packages/custodian/src/destruction-service.ts) — "NO TIMER. Nothing here reads a retention setting, derives a date, or sweeps."

**A hold blocks destruction, not restore.** Restoring a held file is the safe direction, so nothing in this design conflicts with Custodian. What matters is that the _destruction_ half — which this design does not build — must call `readActiveCustodyHoldsForFile`, and today nothing does. Section 5 names that seam so it is not rediscovered.

Discovery has no per-file preservation or hold concept: no discovery table references `file.id`, and its only mention of the word is a comment in [`packages/discovery/src/external-lane.ts:14`](../../packages/discovery/src/external-lane.ts) explaining that discovery reuses the platform's one legal-hold mechanism rather than owning one.

**ADR-0049 already decided the retention story and it is not built.** The decision is trash window on Standard (default 30 days) → Standard-to-IA cold retention → policy-driven destruction blocked by holds, with destruction machinery built and retention defaulted to indefinite. The ledger records the two later stages as `not-started` ([`roadmap.d/documents.md:317-330`](../../roadmap.d/documents.md)), and a repository-wide search for `trash` in `packages/`, `apps/` and `tooling/` returns nothing. So there is **no sweep, no expiry, and no window** behind ADR-0049's 30-day figure today. Section 5 declines to promise one.

## 4. Gap 1 — a `sort` parameter on `files.list`

### 4.1 The orders worth supporting, and the two that are refused

The deciding property is whether the sort column lives on `file` (indexable, keyset-able) or on the joined display version (neither).

| Wire value | Column                                               | Directions              | Index      | Ships                  |
| ---------- | ---------------------------------------------------- | ----------------------- | ---------- | ---------------------- |
| `created`  | `file.created_at`                                    | `asc`, `desc` (default) | exists     | yes, unchanged default |
| `name`     | `file.name`                                          | `asc` (default), `desc` | new        | yes                    |
| `updated`  | `file.updated_at`                                    | `asc`, `desc` (default) | new        | yes                    |
| `size`     | `file_version.size_bytes` of the display version     | —                       | impossible | **no**                 |
| `version`  | `file_version.version_number` of the display version | —                       | impossible | **no**                 |

**`size` and `version` are refused, and the refusal is the honest answer rather than a deferral.** Both live on the row reached through `JOIN file_version dv ON dv.id = <displayVersion>` ([`queries.ts:137-139,158`](../../packages/file-manager/src/queries.ts)), and in include mode `displayVersion` is itself a correlated subquery. No index on `file` can order by a column of a row it has to join to find, so SQLite would materialise every file in the matter and sort it in a temp B-tree — on every page. A keyset cursor over such a column is also unsound in the ordinary case: the display version can change under the caller mid-scroll (a commit advances `current_version_id`), so a row's sort value moves while the cursor is walking past it, and the row is skipped or repeated. Shipping `size` would be shipping the exact defect the cursor exists to prevent. **FM-4** costs the way out.

**`updated` is honest but not what a user means by "Modified".** `file.updated_at` is bumped by every metadata write, including `setEditStateStatement` ([`file-statements.ts:567`](../../packages/file-manager/src/file-statements.ts)) and `clearCurrentObjectStatement` ([`file-statements.ts:527`](../../packages/file-manager/src/file-statements.ts)) — so opening a document for co-editing and closing it both move a file to the top of a "Modified" sort without its content changing. The alternatives are a denormalised `content_updated_at` maintained on version commit (a column, a backfill, and a second source for a fact) or labelling the column what it is. **This design ships `updated` on `file.updated_at` and asks the screen to label it "Last activity", not "Modified".** A content-modified sort is the same problem as `size` and belongs with it under FM-4.

### 4.2 The contract

```
GET /api/v1/files?matterId&folderId&cursor&pageSize&includePendingAndQuarantined
                 &sort=created|name|updated
                 &direction=asc|desc
```

Both optional. `sort` defaults to `created` and `direction` defaults to each order's natural sense (`desc` for `created` and `updated`, `asc` for `name`), so an existing caller's request is byte-for-byte the request it makes today and gets the page it gets today. Additive within `/v1`, so the oasdiff breaking-change gate passes.

An unknown value is a 422 from the zod enum through the app-level `defaultHook`, and the enum names the three permitted orders — so a client asking for `size` is told what it may ask for instead, at the edge, rather than being served an unsorted page.

### 4.3 The cursor, and what happens when the sort changes mid-scroll

The cursor is an opaque `btoa(JSON)` of `{c, i}` — a sort value and an identifier ([`packages/data-access/src/cursor-pagination.ts:20-34`](../../packages/data-access/src/cursor-pagination.ts)) — and carries **no record of which order minted it**. That is the whole hazard: a cursor minted under `created desc` and replayed under `name asc` produces a `WHERE name > '2026-08-01T…'` predicate that is well-formed, silently wrong, and skips or repeats an arbitrary slice of the matter.

**The encoding gains a third key.** `{c, i, s}` where `s` is `"<sort>:<direction>"`. Three properties make this safe to add to a wire contract that must decode across a deploy:

- A cursor minted before the change has no `s`, and decodes as `created:desc` — today's only order, so old cursors keep working exactly.
- A cursor minted after the change and replayed against an older deploy decodes as `{c, i}` with the extra key ignored, which is `JSON.parse`'s behaviour and the existing decoder's ([`cursor-pagination.ts:24-31`](../../packages/data-access/src/cursor-pagination.ts) reads `c` and `i` by name).
- The base64 of a JSON object is not a stable byte sequence anyone can depend on, and the module's own contract is that the cursor is opaque and never parsed elsewhere.

**A cursor whose `s` disagrees with the request is a 422, not a silent restart.** The existing decoder treats a _malformed_ cursor as the first page ([`cursor-pagination.ts:32`](../../packages/data-access/src/cursor-pagination.ts)), which is right — a tampered token reveals nothing by being ignored. A _mismatched_ cursor is different: it is well-formed, it was minted by this system, and the caller is mid-scroll. Restarting silently hands them page one while their UI believes it is page four. 422 is the status this route family already uses for "well-formed request, unusable value" ([`files.ts:451-458`](../../apps/api-worker/src/routes/files.ts) states that reasoning for a blank file name). It needs one new slug in the compile-checked problem-type registry ([`apps/api-worker/src/contracts/problem-types.ts`](../../apps/api-worker/src/contracts/problem-types.ts), the committed slugs being a public contract per [`api.md:54`](../conventions/api.md)): **`cursor-sort-mismatch`**, whose `detail` names the order the cursor belongs to. The client's remedy is to drop the cursor and re-request page one under the new sort, which is what a column-header click means anyway.

### 4.4 The tiebreak, and why every order needs one

`file.name` is **not** unique within a folder (section 2), and `file.updated_at` is a millisecond string that a batch move will duplicate across many rows. Neither is a total order, so both need `id` as the final key or the keyset skips and duplicates — the same reason `listVersionsMissingFromSearchIndexStatement` keys on `(committed_at, id)` and says so ([`queries.ts:1016-1017`](../../packages/file-manager/src/queries.ts)). Every composite below carries `id` last, and the predicate is the row-value form `(sort_column, id) < (?, ?)` — already proven against D1 at [`queries.ts:1023`](../../packages/file-manager/src/queries.ts), so this is not a new dependency on SQLite's row-value support.

### 4.5 The indexes

Four new indexes on `file`, mirroring the shape and the reasoning already recorded at [`per-firm-schema.ts:853-857`](../../packages/database/src/per-firm-schema.ts) — lead with the filter column so one ascending composite serves the filter, both directions of the sort (SQLite walks an index backwards), and the bare FK lookup:

```
file_matter_id_name_id_index        (matter_id, name COLLATE NOCASE, id)
file_folder_id_name_id_index        (folder_id, name COLLATE NOCASE, id)
file_matter_id_updated_at_id_index  (matter_id, updated_at, id)
file_folder_id_updated_at_id_index  (folder_id, updated_at, id)
```

`created` needs nothing — its two indexes already exist.

**The collation has to be pinned in both places or the index is dead.** SQLite uses an index for `ORDER BY` only when the collation matches, so the `ORDER BY` must read `f.name COLLATE NOCASE` and the keyset comparison must too. `NOCASE` folds ASCII only: `Ä` sorts after `z`, and a firm filing in a language with non-ASCII names gets a sort that is stable and locally wrong. The alternative is a stored `name_sort_key` column normalised at write time, which is a column, a backfill, and a second source for a fact the row already holds. **This design ships `NOCASE` and records the limit**; a normalised sort key is the named upgrade if a firm reports it, and it changes an index rather than a contract.

There is no existing `NOCASE` index anywhere in the per-firm schema, so this is the first — worth a line in the migration explaining why, since a later reader will otherwise read it as an accident.

### 4.6 Cost

Four indexes on the busiest per-firm table. The two `name` indexes are written on insert and on rename only. The two `updated_at` indexes are the expensive pair: `updated_at` moves on **every** metadata write including both edit-state transitions, so a matter under active co-editing rewrites two B-tree entries per session open and close. That is the price of a "Last activity" column and it should be paid knowingly. Dropping the two folder-scoped variants halves the write cost and makes a folder-filtered sort scan the matter's files instead of seeking; at the load profile's scale that is free and at a large matter it is not.

**The load-profile harness cannot see any of this.** [`packages/fixtures/src/load-profile/profile.ts:528`](../../packages/fixtures/src/load-profile/profile.ts) sets `filesPerMatter: { min: 3, max: 14 }`. A fourteen-row sort is a fourteen-row sort however it is planned, so the existing baseline will show no difference between the indexed design and the temp-B-tree one it rejects. Measuring this means raising `filesPerMatter` for at least one matter, which bumps the profile `version` and renames the baseline artifact ([`profile.ts:1-4,19-24`](../../packages/fixtures/src/load-profile/profile.ts) state that contract). Under golden rule 10 that fixture change is part of the work, not a follow-up — the alternative is shipping an index nothing has ever demonstrated a need for.

### 4.7 Folders-first grouping: no, and the listing must not learn about it

**The client already holds every folder before it asks for a single file.** `folders.list` ([`apps/api-worker/src/routes/folders.ts:143-157`](../../apps/api-worker/src/routes/folders.ts)) returns a matter's entire folder tree in adjacency-list form, in one unpaged call, with no status gate. Folders-first is therefore a render decision over two lists the client has, not a question the file listing can answer.

Teaching `files.list` about it would mean one of two shapes, both worse than the client doing it:

- Emit folder rows into the `FileSummary` array. A folder has no version, size, sniffed type, verdict or status, so every version-derived field would be null on those rows, and `currentVersionId: null` — the field whose whole job is "this row cannot be downloaded" ([`files.ts:75-77`](../../apps/api-worker/src/routes/files.ts)) — would stop meaning that.
- Add a `groupFoldersFirst` flag whose only effect is to order rows the endpoint does not return.

There is also a mechanical reason the grouping cannot be a page-level property: a folder's children and its files are paged independently, so "folders first" across a cursor boundary is not a thing the server can promise without paging the folder tree too, which `folders.list` deliberately does not do.

**Decision: `files.list` stays a list of files.** The screen renders the folder tree from `folders.list` above the file table, which is also what makes a folder row clickable rather than a sort artefact.

## 5. Gap 2 — restore, and a deleted-files listing

### 5.1 Two routes, and why the listing is not a parameter on `files.list`

```
POST /api/v1/files/{id}/restore          files.restore
GET  /api/v1/files/trash?matterId&cursor&pageSize   files.trash
```

The listing is a separate route for three reasons, and the first is decisive:

1. **`files.list` is `permission: null` and the trash listing is not.** `RouteMeta.permission` is one value enforced at the chokepoint, and [`apps/api-worker/CLAUDE.md`](../../apps/api-worker/CLAUDE.md) states the rule as "No per-handler auth discipline". A parameter that conditionally raises the permission would move enforcement out of the chokepoint and into the handler, which is the one thing that surface exists to prevent.
2. Its rows carry a field the live rows do not — `deletedAt`, non-null by construction — and cannot usefully carry the ones that assume a live file.
3. Its natural order is deletion recency, which would otherwise be a fourth sort order section 4 has to index for.

It is also what keeps gap 1 and gap 2 independent (section 9).

`matterId` is **optional** on the trash listing: absent, it returns the firm's whole trash, which is what "what did I delete" means to a member who does not remember the matter. The `resource: "matter"` binding still holds — `apps/api-worker/CLAUDE.md` requires every `files:*` capability to bind `resource: "matter"` "even for a firm-scoped read like the bundle-status poll", and this is that same case.

### 5.2 Permission: both halves ride `files:delete`

**Restore rides `files:delete`, not a new `files:restore`.** The registry ([`packages/access-control/src/registry.ts:48-51`](../../packages/access-control/src/registry.ts)) has four `files:*` keys and `files:delete` is seeded to exactly two default roles — Owner/Admin and Attorney ([`baseline.sql:948,964`](../../packages/database/drizzle/per-firm/20260704T041516_baseline.sql), against the role rows at lines 904 and 906). Paralegal holds `files:upload` and `files:organize` and not `files:delete`. So the population that can delete is already narrow, and a new `files:restore` key would be seeded to the same two roles, held by the same people, and would encode nothing. Golden rule 1 settles it.

**The listing rides `files:delete` too.** It exists to be acted on; a read-only view of what colleagues deleted, with no ability to undo it, is a surveillance surface with no action attached. One key, both halves, and a member who cannot restore is not shown a list of things they cannot restore.

### 5.3 How long deleted files remain visible

**Unbounded, and the response says when each was deleted rather than when it will go.** ADR-0049 specifies a 30-day trash window, but nothing sweeps: the cold-retention and destruction nodes are `not-started` ([`roadmap.d/documents.md:317-330`](../../roadmap.d/documents.md)) and there is no `trash` identifier anywhere in `packages/`, `apps/` or `tooling/`. A view that presented a 30-day promise would, six weeks after a delete, be showing a file that is still there beside a countdown that expired — which is worse than showing nothing, because it teaches a member that the number is decorative. **FM-3** asks the owner whether to say anything at all.

`deletedBefore` / `deletedAfter` filters are not in v1; the ordering plus `deletedAt` on the row is enough for a screen, and a filter over a window nothing enforces is a filter over a fiction.

### 5.4 The wire shapes

`DeletedFileSummary` — a distinct component, not `FileSummary` with a nullable field, because every row in this list has a non-null `deletedAt` and that should be a schema fact rather than a convention:

```
id, matterId, folderId, name, documentTypeId,
deletedAt          (string, non-null)
sizeBytes          (int | null)   the last clean version's size, for "how much comes back"
versionNumber      (int)
deletedByUserId    (string | null)  see below
```

`FileActionAck` (`{ fileId }`) is the restore response, matching `files.update` and `files.delete` ([`files.ts:150`](../../apps/api-worker/src/routes/files.ts)).

**"Who deleted it" is not on the row today.** `file` has no `deleted_by` column; the actor lives only in the `file.deleted` audit row ([`file-service.ts:1031`](../../packages/file-manager/src/file-service.ts)). A trash view that cannot name the deleter is a trash view a member cannot use to ask a colleague what happened. The options are an audit-log join per row (an N+1 or a second query against a table that is append-only and grows without bound) or a nullable `deleted_by` column set in the same batch that sets `deleted_at`. **This design adds the column.** The "build when in the area" rule is exactly this case: a nullable column on a table already receiving a migration for section 4's indexes, expensive to retrofit once a trash view exists and cheap now. Rows deleted before the migration read null, and the audit log remains the record of record for those.

### 5.5 Restore semantics and failure modes

| Condition                                      | Response                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unknown file                                   | 404 `not-found` — the same body an unknown or deleted file gets everywhere else ([`files.ts:459-475`](../../apps/api-worker/src/routes/files.ts)) |
| File is soft-deleted                           | 200 `{ fileId }`, `deleted_at` cleared, `file.restored` audit row                                                                                 |
| File is already live                           | 200 `{ fileId }`, **no write, no audit row** — see below                                                                                          |
| Caller lacks `files:delete`                    | 403                                                                                                                                               |
| Missing / reused / in-flight `Idempotency-Key` | 400 / 422 / 409, as `files.delete`                                                                                                                |
| Folder gone, name taken                        | **cannot occur** (section 2)                                                                                                                      |

`RouteMeta`: `permission: "files:delete"`, `resource: "matter"`, `audited: true`, `idempotency: "required"`, `idempotencyStore: "firm"` — the same posture as `files.delete` ([`files.ts:233-243`](../../apps/api-worker/src/routes/files.ts)), because restore is the same act pointed the other way.

**One domain change goes with the route.** `restoreFile` today resolves through `requireFileIncludingDeleted` and then composes `restoreFileStatement` plus the audit row unconditionally ([`file-service.ts:1041-1056`](../../packages/file-manager/src/file-service.ts)), and `restoreFileStatement` is an unguarded `SET deleted_at = NULL` ([`file-statements.ts:541`](../../packages/file-manager/src/file-statements.ts)). So restoring a file that was never deleted writes a `file.restored` audit row for an event that did not happen. `softDeleteFile` already refuses the symmetric case and says why — "a second delete would move the recovery window's start and write another audit row for a file that is already gone" ([`file-service.ts:1022-1024`](../../packages/file-manager/src/file-service.ts)). Restore should hold the same line without refusing: the loaded row already carries `deletedAt`, so the service returns an empty effect when it is null and the route answers 200 either way. That keeps the route idempotent — which a required `Idempotency-Key` demands — without putting fiction in an append-only ledger.

### 5.6 What this design deliberately does not build, and the seam it leaves named

No expiry, no Standard-to-IA transition, no hard delete. Those are ADR-0049's later two stages and they carry the questions this design has no standing to answer.

**When the destruction half is built, it must call `readActiveCustodyHoldsForFile`** ([`packages/custodian/src/hold-statements.ts:153-160`](../../packages/custodian/src/hold-statements.ts)). That function exists for this caller, its own comment says so, and nothing calls it. A destruction sweep written without it would be able to destroy the scan of a will under a legal hold, and would look correct while doing so. Restore has no such obligation — a hold blocks destruction and a restore is the direction a hold wants.

## 6. Gap 3 — the scan detail on the wire

### 6.1 Reuse the shape that already exists

`ScanDiagnosis` ([`apps/api-worker/src/routes/scan-diagnose.ts:25-33`](../../apps/api-worker/src/routes/scan-diagnose.ts)) is a registered OpenAPI component that already splits this correctly, and it is already on the wire:

```
verdict: clean | infected | unscanned | suspicious
engineVersion: string | null
signature:     string | null     the malware name, for an `infected` verdict
reason:        string | null     why unscanned/suspicious (no-engine, encrypted, decompression-bomb, …)
activeContent: boolean           a clean file that still carries active content
```

Golden rule 1 says compose rather than reinvent. The file listing's fields mirror these names, so a client that has learned one shape has learned both.

### 6.2 The contract

Two fields added to `FileSummary`, and the same two to `FileVersionItem` (section 7 is already opening that shape):

```
scanReason:    enum | null
activeContent: boolean
```

`scanReason` is a **closed** enum of the tokens the platform authors — `oversize`, `encrypted`, `no-engine`, `active-content` excluded (it is the boolean), the three structural heuristics `decompression-bomb` / `archive-nesting` / `archive-entry-count`, and the four gate reasons `size-mismatch` / `type-mismatch` / `policy-size` / `policy-type` — plus one collapsing token, `scan-flagged`, for a version flagged by a named signature or a YARA rule.

`quarantineReason` **stays exactly as it is**, because narrowing a shipped field is a breaking change and `/v1` is additive-only ([`api.md:17`](../conventions/api.md)). Its `description` gains a deprecation note pointing at `scanReason`, and it is removed at `/v2`.

### 6.3 The classifier, and why this reduces exposure

`scan_detail` is one open text column, so the enum has to be derived at projection time. That derivation is a pure function and it belongs in [`packages/file-manager/src/verdict.ts`](../../packages/file-manager/src/verdict.ts), beside `scanDetailFor`, for the reason the file-manager `CLAUDE.md` gives for `scanDetailFor` itself: three call sites once decided this separately and two disagreed.

```
coarseScanReason(scanVerdict, versionStatus, scanDetail) -> { scanReason, activeContent }
```

- `scan_detail === "active-content"` → `{ scanReason: null, activeContent: true }`
- `scan_detail` matches a platform-authored token → that token, `activeContent: false`
- any other non-null `scan_detail` on a `flagged` verdict or a `quarantined` row → `{ scanReason: "scan-flagged", activeContent: false }`
- null → `{ scanReason: null, activeContent: false }`

**The last-but-one branch is the point.** Today a raw ClamAV signature reaches `files.list` through `quarantineReason`, untagged, on a route that is `permission: null` and `audited: false` (section 1.3). Under this design `scanReason` collapses it to `scan-flagged`, and the raw name stays reachable only where it already belongs: the audited download refusal ([`files.ts:816,832`](../../apps/api-worker/src/routes/files.ts)) and `scan.diagnose`, which is gated on `firm:scanFile` and writes an audit row for every call ([`scan-diagnose.ts:35-38`](../../apps/api-worker/src/routes/scan-diagnose.ts)). Once `quarantineReason` is removed at `/v2` the listing carries no engine free text at all.

**No raw signature is proposed for the listing.** A ClamAV signature name is engine-supplied text whose shape the platform does not control — hash-derived and string-derived fragments appear in real signature sets — and the listing is the one file surface that is neither permissioned nor audited. **FM-2** puts the counter-case to the owner, since the field exists today and removing it at `/v2` is a decision to take deliberately rather than by drift.

### 6.4 Adjacent finding, out of scope

[`packages/telemetry/src/events.ts:87-92`](../../packages/telemetry/src/events.ts) gives `ingest.verdict` a `scanDetail` dimension and [`ingest-consumer.ts:228-243,356`](../../apps/api-worker/src/files/ingest-consumer.ts) fills it with the raw string, so a signature name reaches cross-firm analytics on every quarantine. The event's own comment claims the redaction is structural — "there is NO slot for file id, name, r2 key, or content" — which is true of everything except the slot that is there. Once `coarseScanReason` exists, that dimension should take the coarse token; the event keeps its shape and loses nothing it is used for. **FM-5**, flagged rather than decided because it is a different subsystem's contract.

### 6.5 Cost

No schema, no index, no migration. One pure function with an exhaustive switch, one projection change in [`queries.ts`](../../packages/file-manager/src/queries.ts), two fields on two wire shapes, a snapshot re-emit and a client regeneration. This is the cheapest of the four by a wide margin and it is the only one that leaves the API exposing less than it does today.

## 7. Gap 4 — the version's author

### 7.1 The contract

`FileVersionItem` gains two fields, and `FileSummary` gains the same two for its display version:

```
uploadedByUserId:      string | null
uploadedByDisplayName: string | null
```

Both nullable, and each for its own reason — which is why they are two fields rather than one object that is either present or absent:

- `uploaded_by` is nullable on the column ([`per-firm-schema.ts:904`](../../packages/database/src/per-firm-schema.ts)) and genuinely null for versions no member produced. The repair and carve path writes null (`apps/api-worker/test/file-repair-attach.test.ts:161` seeds exactly that row).
- The **name** can be null while the identifier is not, because `uploaded_by` is deliberately not a foreign key — the schema's own comment is "the upload fact outlives the member row". A version committed by a member since removed keeps its identifier and resolves to no name. Collapsing the two into one nullable object would erase that distinction, which is the one the non-FK decision exists to preserve.

### 7.2 Why the name is embedded rather than resolved by the client

Section 2 establishes that no route maps a user identifier to a display name, so identifier-only ships an unrenderable field.

The precedent for embedding runs the other way and is close: `BillingAuthorizedMember` ([`apps/api-worker/src/routes/billing.ts:267-270`](../../apps/api-worker/src/routes/billing.ts)) is `{ userId, displayName }`, and its comment states the reason a bare identifier was not enough — "a member the firm has given the authority to act on client money, **named** so a pending application can say who is able to release it rather than only that somebody must". A custody ledger that can say only that _somebody_ committed version 4 has the same defect.

The resolution is a `LEFT JOIN member ON member.user_id = v.uploaded_by` in `listCleanVersionsStatement`. `member` is a per-firm table keyed on `user_id` carrying a display name ([`pii-registry.ts:657-658`](../../packages/data-access/src/pii-registry.ts) describes it as exactly that), so this is a primary-key join, not a scan, and it adds no round trip.

**FM-1** puts the choice to the owner, because embedding a person's name in a response is a disclosure decision rather than a schema one, and the recommendation depends on a route that could instead be built.

### 7.3 The PII registry is currently wrong about `file_version`, independent of this change

[`packages/data-access/src/pii-registry.ts:694-696`](../../packages/data-access/src/pii-registry.ts) lists `file_version` in `NO_PII_TABLES` with the note "file-version metadata (r2_key, hashes, status) — no personal data of its own". The note enumerates three columns and the table has `uploaded_by`.

The registry's own precedents settle what that column is. `time_entry.timekeeper_user_id` ([line 87](../../packages/data-access/src/pii-registry.ts)), `incident.reported_by` ([line 92](../../packages/data-access/src/pii-registry.ts)) and `audit_log.actor_user_id` ([line 95](../../packages/data-access/src/pii-registry.ts)) are all registered `pseudonymize-keep`, and the `member` entry states the distinction being drawn: those rows are "the subject's own erasure-relevant ACTIVITY", as against `member` itself which is "current operational state". "Who committed this version of this document" is activity, on the same line as "who logged this time entry".

So the schema work for gap 4 is not a migration. It is a one-line move:

```
{ table: "file_version", subjectKey: "uploaded_by", action: "pseudonymize-keep",
  note: "who committed a version of a document — the same activity line time_entry.timekeeper_user_id sits on; a version row is immutable, so the author reference is replaced, never removed" }
```

out of `NO_PII_TABLES` and into `PII_TABLES`. The coverage fitness test forces every schema table into exactly one list, so the move is mechanical and the test proves it landed.

**This misclassification is a live defect today**, not one this design creates: the column has been on the row since the baseline and the deferred `eraseDataSubject` orchestrator traverses `PII_TABLES`, so a firm member's erasure would today miss every version they uploaded. It should be corrected whether or not the wire field ships. Reported here because this is where it was found.

### 7.4 One semantic to record on the screen, not in the schema

`restoreVersion` sets the new version's `uploadedBy` to the member performing the restore ([`file-service.ts:1058-1062`](../../packages/file-manager/src/file-service.ts) — `uploadedBy: UserId; // the actor restoring — the new version's author`). That is the correct answer to "who put these bytes here as version N", and it will read as "Jane uploaded version 7" for a version whose content is a copy of version 3. The custody ledger is not wrong; the screen should show the version's own provenance and let the version list's numbering carry the rest.

### 7.5 Cost

No migration, no index. One column in one `SELECT`, one `LEFT JOIN`, two fields on two wire shapes, one registry move, a snapshot re-emit, a client regeneration. Second-cheapest of the four.

## 8. Owner flags

| Flag     | Question                                                                                                                                                                                                       | Why it is not decided here                                                                                                                                                                                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FM-1** | May a firm member's display name be embedded in the version-history and file-listing responses, or should the API return only the pseudonymous user identifier and gain a member-directory read to resolve it? | Embedding a person's name in a response is a disclosure decision. Section 7 recommends embedding, on the `BillingAuthorizedMember` precedent and because no resolver exists — but building a members-list read is the alternative and it is a real one.                                                             |
| **FM-2** | Should the file listing carry the raw engine-supplied malware signature, or only the coarse `scan-flagged` token?                                                                                              | It carries the raw signature **today**, untagged inside `quarantineReason`, on an unpermissioned unaudited route. Section 6 recommends collapsing it and keeping the raw name on the two audited paths — but removing information a client can already see is a deliberate act, not a cleanup.                      |
| **FM-3** | Does the trash view present a retention window, given ADR-0049's 30-day figure has no sweep behind it?                                                                                                         | Section 5 recommends showing `deletedAt` and promising nothing. Showing a countdown nothing honours teaches members the number is decorative; showing nothing means a firm cannot see how long its trash has been growing.                                                                                          |
| **FM-4** | Do `size` and `content-modified` sorts justify a denormalised column on `file` (`current_version_size_bytes`, `content_updated_at`), maintained in the version-commit batch?                                   | Section 4 refuses both orders because they live on the joined display version and cannot be indexed or keyset-paged soundly. The way out is denormalisation: two nullable columns, a backfill, and a second source for facts the version row already holds — which is a real cost against a real screen affordance. |
| **FM-5** | Should `ingest.verdict`'s `scanDetail` telemetry dimension be narrowed to the coarse token?                                                                                                                    | Adjacent, and a different subsystem's contract. It is the **widest** exposure of the raw signature — cross-firm analytics rather than one firm's response — and once `coarseScanReason` exists the narrowing is one argument.                                                                                       |

## 9. Order by value-to-cost, and what depends on what

Ordered by value returned per unit of cost, not by raw value. **Gap 1 is the most valuable of the four to the screen; it is third here because it is the only one carrying a migration, an index budget, a correctness hazard, and a load-profile change.**

**1. Gap 3 — scan detail (cheapest, and the only one that removes exposure).** No schema, no index, no migration; one pure function, two fields, a shape to copy that is already registered. It also closes an accidental leak that exists today. Build it first regardless of what else is scheduled.

**2. Gap 4 — the version's author.** No migration — `uploaded_by` has been on the row since the baseline. One `SELECT` column, one primary-key join, two wire fields, one PII-registry move that is a standing defect and should be made whether or not the field ships. Unblocks the custody ledger outright.

**3. Gap 1 — sort.** The screen's headline feature and the largest of the four: four indexes, a cursor-encoding change, a new problem type in the committed contract, two sort orders refused with reasons, and a load-profile fixture change without which nothing measures it. It also contains the only way to get this wrong silently — a cursor replayed under a different order — which is why section 4.3 spends its length on a 422.

**4. Gap 2 — restore and trash.** Two routes, a permission decision, a `deleted_by` column, a partial index, a domain fix to `restoreFile`, and a retention story it must decline to promise. Highest raw value to a member who deleted the wrong thing; highest cost, and the only one that lands beside an ADR whose later stages are unbuilt.

### Independence

- **Gaps 3 and 4 are independent of everything, including each other** — different columns, different shapes, no shared decision. Either can ship alone.
- **Gap 2 is independent of gaps 1 and 3** _because_ its listing is a separate route (section 5.1). Had it been a mode on `files.list`, its deletion-recency order would have been a fourth sort gap 1 had to carry, and the two would have had to land together. The separate route buys that independence and the chokepoint permission property in the same decision.
- **Gap 1 must land after or with gap 3.** Both rewrite `FILE_SUMMARY_COLUMNS`, `listFilesStatement` and `toFileListItem` in [`queries.ts`](../../packages/file-manager/src/queries.ts), and both add fields to `FileSummary` in [`files.ts`](../../apps/api-worker/src/routes/files.ts). Gap 3 is projection-only, so landing it first leaves gap 1 a clean rewrite of the ordering alone.
- **Gap 4's wire field and its PII-registry move must land in one commit.** Shipping the field over a table classified `NO_PII` is knowingly leaving the coverage test asserting something false.
- **Gaps 3 and 4 both edit `queries.ts` and `files.ts`.** Independent in design, contended in the file system — under the root `CLAUDE.md`'s one-owner-per-file rule they go to one agent or run in sequence, never in parallel.

### Shared cost, whichever subset is built

Every one of the four re-emits `apps/api-worker/openapi/openapi.json` and regenerates `packages/api-client` in the same commit, and all four are additive within `/v1`, so oasdiff passes. Gaps 1 and 2 add operations, which means the exact operation list in [`apps/api-worker/test/conformance.test.ts:737`](../../apps/api-worker/test/conformance.test.ts) gains entries — a deliberate edit, since that list exists to make the suite non-vacuous. Gap 1's `cursor-sort-mismatch` is a new committed problem-type slug and therefore a permanent public URI.

## 10. What this design does not answer

- The screen. Column set, default sort, empty states, and how a trash view is reached are the file-manager UI stream's (`claude/ui-file-manager`).
- ADR-0049's trash expiry, Standard-to-IA transition, and destruction. Section 5.6 names the Custodian seam that half must honour and builds none of it.
- Whether `file_version.uploaded_by` should become a foreign key. It is deliberately not one and this design depends on that; revisiting it is a different question about member deactivation.
- The `documents.versioning.deleted-lifecycle.trash` ledger node reading `shipped` for a capability no route reaches (section 1.2). The correction belongs with the ledger's owner.
