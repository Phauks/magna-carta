# Always-commit ingest — a system of record keeps the file it was given

**Status:** proposed. Design only; nothing here is built.

**The ruling, in the owner's words, and it is not reopened here:**

> "If a user uploads a file, even if we think it has a security issue or is a different file type, it
> is still uploaded and committed. It is up to the user to deal with the file. Not saving the file
> would be a major hazard."

The reasoning carries into every decision below. For a law firm, silently refusing to keep a client's
document because a scanner disliked it is a worse failure than holding a flagged one. A
practice-management platform is a system of record first, and a system of record that discards
records on a heuristic is not one. The design question is therefore not _whether_ to keep the file —
it is what has to change, everywhere, once nothing is thrown away, and what that costs.

This spec settles that. It touches the File Manager, the access surfaces that reach a version's
bytes, the search corpus, the bulk-download bundle, the editing paths, and one new read surface. The
decision itself is recorded as an ADR draft in
[`docs/decisions/pending/a-system-of-record-keeps-the-file-it-was-given.md`](../decisions/pending/a-system-of-record-keeps-the-file-it-was-given.md),
superseding the parts of the accepted ingest and scan-policy decisions that this reverses.

**Related work in flight.** `claude/file-api-gaps`, `claude/file-api-gaps-build` and
`claude/file-manager-unknowns` are all in the File Manager; `claude/api-worker-rename` is renaming
`apps/worker`. Every path in this document is written against the tree as it stands today
(`apps/worker`), and the build that follows this spec should re-check them.

---

## 1. What is true today

### 1.1 The five refusals, and the one withdrawal

`runIngest` (`packages/file-manager/src/ingest-core.ts`) returns one of two outcomes for a pending
version. Five conditions produce `quarantine`; everything else produces `commit`.

| Reason          | Test                                                                                     | Is it a judgment about content?  |
| --------------- | ---------------------------------------------------------------------------------------- | -------------------------------- |
| `size-mismatch` | the read byte count is not the size R2 reported, **or** not the size the client declared | No — a transfer or a claim       |
| `type-mismatch` | `contentTypesAgree(sniffed, declared)` is false                                          | **Yes**                          |
| `policy-size`   | the real byte count exceeds the firm's `maxSizeBytes`                                    | Partly — a limit, after the fact |
| `policy-type`   | the sniffed type is off the allow-list, or the file name's extension is blocked          | **Yes**                          |
| `scan-flagged`  | `computeVerdict` returned `flagged` **and** `flaggedTreatment` is `block`                | **Yes**                          |

Three further outcomes are not refusals and are worth naming so the line below is drawn in the right
place:

- **`ScanFaultError`** — a deployed engine reported unavailable. The consumer throws, the queue
  retries, and at max attempts the message dead-letters. The version stays `pending`;
  `redriveStrandedPendingVersions` re-enqueues it. Nothing is refused, but nothing commits either.
- **The over-cap short-circuit** — an object past `inspectableSizeCapBytes` bypasses the scan engine
  entirely and commits as `unscanned` with `scan_detail: "oversize"`. This is already the
  always-commit posture, applied to one case, and it is the precedent the rest of this design
  generalizes.
- **The custody withdrawal** — `quarantineCommittedVersion` un-commits an already-committed version
  whose stored bytes no longer hash to the value recorded at commit. This is the only path that
  moves a version out of `clean`.

### 1.2 What a quarantine actually does to the row

`quarantineVersionStatement` writes exactly two columns:

```sql
UPDATE file_version SET status = 'quarantined', scan_detail = ?2 WHERE id = ?1 AND status = 'pending'
```

Everything the pipeline measured is discarded. `size_bytes`, `sniffed_content_type` and
`content_sha256` stay NULL; `committed_at` stays NULL; `declared_content_type` keeps whatever the
client claimed. **This is the owner's second complaint, and it is structural, not an oversight in one
statement:** a `type-mismatch` row records that the two types disagreed and records neither of them.

Four further consequences follow from the quarantine batch, and each of them is a fact the design
below inherits:

1. **`file.current_version_id` is never set.** Only `bumpFileCurrentVersionStatement`, inside the
   commit batch, moves it. A first upload that quarantines leaves the file with a null pointer, so
   `selectFileSummaryStatement`, `getCurrentCleanVersion`, and every other current-version read
   return nothing and the routes 404.
2. **The bytes are structurally unreachable.** Every `file_version` read filters `status = 'clean'`,
   enforced by a source-scan fitness function. There is no download path, no preview path, no
   presigned URL, and no acknowledgement ceremony that reaches a quarantined version.
3. **The storage meter never counts them.** `meterCommitStatements` runs only in the commit batch. A
   quarantined object sits in the firm's bucket unmetered until the daily reconciliation sweep
   (`reconciliationDiff`, which diffs an R2 LIST against the meter rows) corrects the meter upward as
   drift. Every quarantine manufactures a fresh unit of that drift.
4. **The upload session is never closed.** `setUploadSessionStatusStatement` runs only in the commit
   and no-op-skip batches. A quarantined version leaves its session `open` until
   `sweepStalePendingUploads` expires it.

The file appears in the matter list only in the opt-in `includePendingAndQuarantined` mode, where the
SPA paints it "Rejected" with the `scan_detail` string beside it
(`apps/web/src/lib/documents/document-presentation.ts`). `hasReadableContent` is false, so every
content action is disabled. That is the whole of what a firm gets today: a name, a red chip, and a
reason.

### 1.3 What already exists and is close to what the owner wants

The platform already knows how to hold a dangerous file and gate access to it, and it already does so
in three places.

- **`scan.flagged_treatment`** (`packages/file-manager/src/scan-policy-settings.ts`) is a per-firm
  setting with three values. `block` quarantines at ingest and refuses at download.
  `informed-access` commits the version and gates the raw download behind an `acknowledgeMalware=true`
  re-request, recording a `file.downloaded_malware_acknowledged` audit row. `allow-and-flag` commits
  and serves, with a `flagged` marker in the audit metadata. **The default is `block`**, chosen to
  preserve the behaviour that predates the setting.
- **The re-scan path never withdraws.** `recordRescanVerdict` stamps a fresh `flagged` verdict onto
  an already-committed version _without_ moving the current-version pointer or the status. A file
  that was clean yesterday and is malware today stays visible and stays listed; only access is gated.
  The comment on `rescanVerdictStatement` says so in as many words: "informed access, no data loss".
- **Discovery already refuses to parse rather than refusing to keep.**
  `scanVerdictAdmitsParsing` in `packages/discovery/src/external-lane.ts` returns true only for
  `clean`, and its header states the principle exactly: "A flagged file in discovery IS EVIDENCE.
  Quarantine, never auto-delete... the honest outcome is a review document present in the corpus and
  present in the manifest, carrying a malware-flagged exception, that no parser opens."

So the platform's stance is already inconsistent: a file that turns out to be malware _after_ it
committed is kept and gated, and a file that is malware _when it arrives_ is destroyed. The owner's
ruling removes the inconsistency in the direction the rest of the platform already leans.

### 1.4 The engine is dormant, and the sweep is not attached

Two facts about the current deployment change how urgent parts of this are.

- **`scan-flagged` does not fire in production today.** `resolveScanPort` returns the engine-less
  `unscannedAdapter` until the `SCAN_SERVICE` binding is present, and that adapter yields
  `unscanned`/`no-engine`. The `containers/scan` engine is built but dormant. So the reversal of the
  scan refusal is, right now, a change to a code path nothing exercises — which makes this a good
  moment to make it, and a bad moment to assume it is theoretical.
- **The weekly re-scan sweep does not exist as a scheduled pass.** The File Manager notes describe a
  `0 4 * * 0` re-scan cron; `apps/worker/wrangler.jsonc` carries three triggers (`*/5 * * * *`,
  `0 3 * * *`, `*/10 * * * *`), the Sunday 04:00 slot is held by the natural-language keep-alive, and
  `listUnscannedCommittedVersions` has no caller outside the load-profile harness. **Nothing sweeps.**
  The only re-examination that happens at all is `maybeEnqueueRescanOnAccess`, which fires on download
  and preview, and only when a `fileManager.scanEngineVersion` has been recorded. A file nobody opens
  is never re-scanned. Section 6 treats this as a blocker rather than a follow-up.

---

## 2. The new posture

**Every upload that completes commits.** Safety and type findings become properties of a committed
version, recorded on it, surfaced everywhere it is read, and enforced at the moment somebody tries to
_reach_ the bytes. They are never reasons to refuse the record.

Three sentences carry the whole design:

1. **Storage is unconditional; access is conditional.** The gate moves from the write path to the
   read paths, and `flaggedTreatment` — which already exists and already governs one read path — is
   the mechanism.
2. **A finding is data, not a lifecycle state.** Every judgment the pipeline makes is written as a
   row a person can list, filter and act on, instead of being collapsed into one string on a row
   nobody can reach.
3. **What still refuses is about the transfer or the platform's capacity, never about the content.**

### 2.1 What refuses, before and after

| Condition                                              | Today                      | After                                                                 |
| ------------------------------------------------------ | -------------------------- | --------------------------------------------------------------------- |
| Declared size/type violates policy, checked at presign | Refused (no upload starts) | **Still refused** — no bytes exist yet; nothing is lost               |
| Read byte count ≠ the size R2 reports for the object   | Quarantined                | **Still refused** — the transfer is corrupt; the bytes are not a file |
| Read byte count ≠ the size the client _declared_       | Quarantined                | Committed, finding `declared-size-mismatch`                           |
| Sniffed type contradicts declared type                 | Quarantined                | Committed, finding `type-mismatch`, both types recorded               |
| Real size over the firm's `maxSizeBytes`               | Quarantined                | Committed, finding `policy-size`                                      |
| Sniffed type off the allow-list                        | Quarantined                | Committed, finding `policy-type`                                      |
| File name extension on the blocklist                   | Quarantined                | Committed, finding `blocked-extension`                                |
| `computeVerdict` returns `flagged`, treatment `block`  | Quarantined                | Committed, finding `scan-flagged`, **access** blocked                 |
| `computeVerdict` returns `flagged`, other treatments   | Committed                  | Committed, finding `scan-flagged`, access per treatment               |
| Object past the inspectable-size cap                   | Committed `unscanned`      | Unchanged, plus finding `scan-unscanned` (`oversize`)                 |
| Engine deployed but unavailable                        | Retry, then dead-letter    | Retry, then **commit `unscanned`** with finding `scan-fault`          |
| Object not yet readable in R2                          | Retry (transient)          | Unchanged                                                             |
| Upload session abandoned or expired                    | Version abandoned          | Unchanged                                                             |
| Stored bytes no longer match the committed hash        | Version withdrawn          | Unchanged — see 2.4                                                   |
| Firm over its storage quota                            | No quota exists            | **Refused at presign** if a quota is adopted — see AC5                |

The line is drawn at one question: **do we have a whole file?** A truncated transfer is not a file we
were given, so refusing it loses nothing and keeping it would put a row in the record asserting bytes
that were never delivered. A declared-size disagreement is different — R2 tells us the object's real
size and we read exactly that many bytes, so the file is whole and the client's declaration was
merely wrong. That is a finding, not a failure.

The other line is **before or after the bytes exist.** A presign-time refusal costs the uploader a
retry and costs the firm nothing. A post-upload refusal costs the firm the file while the bytes sit
in its bucket anyway. That asymmetry is why every remaining structural refusal — including a future
quota — belongs at presign.

### 2.2 The version state machine

Four states today: `pending`, `clean`, `quarantined`, `abandoned`. After this change, `quarantined`
has exactly one producer left — the custody withdrawal — and `clean` no longer means what it says.

**`clean` is renamed to `committed`, and `quarantined` to `withdrawn`.** This is the part of the
change that is easy to skip and should not be. The word `clean` is load-bearing in comments,
function names (`getCurrentCleanVersion`, `listCleanVersions`, `selectCurrentCleanVersionStatement`),
the invariants register, and the fitness function's error message. Every one of those currently
tells a reader that a committed version is safe. Under this design, `status = 'clean'` on a row that
carries a live ClamAV signature match is a sentence that is false, and it will be read as true by the
next person who writes a query.

| State       | Means                                                                      | Servable |
| ----------- | -------------------------------------------------------------------------- | -------- |
| `pending`   | reserved; the bytes have not been measured                                 | No       |
| `committed` | measured and recorded; findings may be attached; the row's assertions hold | Per gate |
| `withdrawn` | the object at this key no longer matches what the row asserts              | No       |
| `abandoned` | no version was cut (the no-op hash skip, or an expired session)            | No       |

**Migration shape for the rename (expand-contract, per the database package's rules).** The
`file_version_status_check` CHECK widens to accept all six tokens; new writes emit `committed` /
`withdrawn`; a data migration rewrites existing rows; predicates move to `IN ('clean','committed')`
for one release and then to the single token; the CHECK contracts last. The fitness function that
rejects a `file_version` SELECT without a status predicate is what makes this tractable — it already
enumerates every site that has to change, and it will fail on any site that is missed.

The cheaper alternative is to keep the stored tokens and rename only in the type layer and the docs.
It is not recommended: the SQL is where the misreading happens, and half a rename leaves the two
vocabularies to disagree.

### 2.3 `currentVersionId`, and what stops being true

**A flagged version becomes current.** `bumpFileCurrentVersionStatement` is monotonic on
`version_number` and runs in every commit batch, so once every completed upload commits, the newest
version is always the current one regardless of its findings. That is what the ruling requires: the
document the person uploaded is the document the matter shows.

The fact that stops being true is this one, from `packages/file-manager/src/file-statements.ts`:

> `current_version_id` is clean-BY-CONSTRUCTION — the file listing joins through it without a status
> predicate on the strength of that.

After this change it is **committed**-by-construction. The join is still sound (a withdrawn version
is repointed away from, and a pending one was never pointed at), but nothing may any longer infer
_safety_ from the pointer. Every read below inherits that, and each one is listed with what it must
now do.

#### Reads that resolve the current version

| Path                                                                 | Reader                                          | Today                                | Must become                                             |
| -------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------- |
| `listFiles` / `listFilesStatement`                                   | matter file table                               | projects `scanVerdict`, no gate      | + finding count; `status` values change                 |
| `getFileSummary` / `selectFileSummaryStatement`                      | file detail read                                | no gate                              | + findings; `status` always `committed`                 |
| `getCurrentCleanVersion`                                             | **download** (`routes/files.ts`)                | treatment applied                    | unchanged in kind; rename                               |
| `getCurrentCleanVersion`                                             | **offline checkout** (`checkout-routes.ts`)     | **no gate** — presigns a GET         | **apply treatment**                                     |
| `getCurrentCleanVersion`                                             | reconcile response (`checkout-routes.ts`)       | id only, no bytes                    | no gate needed                                          |
| `getFileWithCurrentCleanVersion`                                     | **editor launch** (`edit-session-route.ts`)     | **no gate**                          | **apply treatment**                                     |
| `getFileWithNamedVersion`                                            | WOPI `GetFile` (`wopi-routes.ts`)               | refuses `flagged` outright           | keep; honour `allow-and-flag`                           |
| `getCurrentCleanVersionForPreview`                                   | preview grant (`routes/files.ts`)               | `decidePreview` degrades to download | + refuse under `block` (today it hands out a dead link) |
| `listCleanVersions`                                                  | version history                                 | no gate                              | + per-version findings                                  |
| `listCleanCurrentVersionsByMatter`                                   | **bulk ZIP** (`routes/downloads.ts`)            | **no verdict predicate at all**      | **apply treatment**; never silently omit                |
| `loadIndexableVersion`                                               | **search indexing** (`search/enqueue-index.ts`) | **no verdict predicate**             | **AC2** — metadata-only for flagged                     |
| `getCurrentVersionForIntegrity`                                      | hash & integrity tool                           | no gate                              | **deliberately stays ungated** — see 4.6                |
| `loadCommittedVersionByR2Key`                                        | custody check + access re-scan                  | no gate                              | unchanged                                               |
| `listCleanVersionR2Keys`, `listTierableVersions`                     | reconciliation, tiering sweeps                  | no gate                              | unchanged — they never serve bytes                      |
| `listStaleMatterVersionsForRescan`, `listUnscannedCommittedVersions` | re-scan enumerators                             | `unscanned` only                     | widen to `flagged` too — see 6                          |
| `listVersionsMissingFromSearchIndex`                                 | re-extraction sweep                             | no gate                              | inherits AC2                                            |
| `getConflictPendingVersion(s)`                                       | check-in reconciliation                         | no gate                              | inherits the editor gate                                |
| `hasReadableContent` (`apps/web`)                                    | every SPA content action                        | `status === "clean"`                 | `status === "committed"` + a treatment-aware action set |

#### Producers that write through the ingest chokepoint

`initiateUpload` + the R2 event is the single entrance, and six subsystems use it. Each of them
today can have its output silently destroyed by a quarantine verdict, which is the owner's hazard in
its sharpest form:

| Producer                                | What a quarantine destroys today                                           |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `apps/web` document upload              | the member's file                                                          |
| `emails/attachment-extraction.ts`       | **a client's emailed attachment** — with no upload UI to report it         |
| `assemblies/assembly-consumer.ts`       | a document the platform itself just generated and told the member it filed |
| `discovery/archive-expansion.ts`        | an expanded member of a production — material under a discovery obligation |
| `routes/file-repair.ts`                 | the repaired copy of a file that was already damaged                       |
| `editing/checkout-routes.ts` (check-in) | **an offline edit that exists nowhere else**                               |

The last two are the ones to hold in mind when weighing the change. An offline working copy that
fails the gate on its return leg is a member's work with no other home, and today it is dropped.

### 2.4 The one commit-reversal that survives, and why

`quarantineCommittedVersion` stays. It is not a judgment about a file — it is the discovery that the
row no longer describes anything. The committed row asserts "these bytes, this hash, this size, this
verdict"; once the object behind the key changes, every one of those is about content that is gone.
Leaving the row `committed` would put a hash on the record that the bytes do not answer to, which is
a worse failure than any of the ones this design is fixing.

What it does _not_ do, and should, is keep the replacement bytes. Today it scans them, writes a
sentence about them into `scan_detail`, and lets the object stand at the withdrawn version's key with
no row describing it. That is exactly the shape the ruling objects to, arriving by a different door.
Capturing them as a new version means a server-side copy to a freshly minted key (the withdrawn
version's key is taken, and `file_version_r2_key_unique_index` is not negotiable), which is real work
and has a ~5 GiB single-copy ceiling. **AC6.**

---

## 3. Findings — the data model

### 3.1 Why a table and not columns

A version can be several things at once: a `.exe` renamed to `.pdf`, over the size cap, and carrying
a signature match. Columns cannot hold that, and the existing `scan_detail` — one nullable string —
already loses information every time two conditions are true. The analysis surface the owner asked
for is a list of _issues_, plural, so the storage shape has to be one row per issue.

### 3.2 `file_version_finding`

Per-firm table. Handle prefix `fileVersionFinding_`, registered in
`packages/identifiers/src/registry.ts` beside `fileVersion`.

| Column            | Type               | Notes                                                                                |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------ |
| `id`              | text, PK           | `fileVersionFinding_` handle                                                         |
| `file_version_id` | text, FK, not null | → `file_version.id`                                                                  |
| `matter_id`       | text, FK, not null | denormalized provenance so the analysis read is one indexed table — see 5.3          |
| `category`        | text, CHECK        | `safety` \| `type` \| `policy` \| `integrity` \| `processing`                        |
| `kind`            | text, CHECK        | the closed list below                                                                |
| `detail`          | text, nullable     | an engine token: a rule id, a signature name, a heuristic reason. **Never content.** |
| `expected`        | text, nullable     | the declared side of a disagreement                                                  |
| `observed`        | text, nullable     | the measured side                                                                    |
| `engine_version`  | text, nullable     | the engine that produced it; NULL for a gate finding                                 |
| `created_at`      | text, not null     |                                                                                      |

Indexes: `UNIQUE (file_version_id, kind)` — one finding per kind per version, so a re-scan replaces
its own rather than accumulating; and `(matter_id, category, created_at, id)` for the analysis
surface's keyset page.

The `kind` list, closed by CHECK so a new kind is a deliberate migration:

| `kind`                   | `category`   | `expected` / `observed`                                  |
| ------------------------ | ------------ | -------------------------------------------------------- |
| `type-mismatch`          | `type`       | declared MIME / sniffed MIME                             |
| `declared-size-mismatch` | `integrity`  | declared bytes / measured bytes                          |
| `policy-size`            | `policy`     | the firm's cap / the measured size                       |
| `policy-type`            | `policy`     | the allow-list pattern set / sniffed MIME                |
| `blocked-extension`      | `policy`     | — / the extension                                        |
| `scan-flagged`           | `safety`     | — / — (`detail` carries the signature or rule id)        |
| `scan-unscanned`         | `safety`     | — / — (`detail` is `oversize`, `encrypted`, `no-engine`) |
| `scan-fault`             | `safety`     | — / — (a deployed engine never answered)                 |
| `active-content`         | `safety`     | — / — (PDF JavaScript, Office macros)                    |
| `content-drift`          | `integrity`  | recorded hash / measured hash                            |
| `extraction-failed`      | `processing` | — / the stage that failed                                |

**Redaction is a hard constraint on this table, not a convention.** It is a new place privileged
content could leak, and the shapes above are chosen so it cannot: `detail` holds engine identifiers
(a YARA rule name, a ClamAV signature name, a heuristic reason token — all fixed vocabulary from the
engine, never a matched string); `expected` and `observed` hold MIME types, byte counts, hex digests
and file extensions. No column ever holds a file name, a path, an excerpt, or a matched byte range.
This follows golden rule 4 and the standard in
[`docs/conventions/error-logging.md`](../conventions/error-logging.md).

### 3.3 Where findings are written

Inside the commit batch, behind `assertVersionStatusStatement` like every other consequence of the
status change — the batch is all-or-nothing, and a finding that outlived a commit that lost its race
to an abort would describe a version that never committed.

`runIngest`'s `IngestOutcome` loses its `quarantine` arm and gains a `findings: readonly Finding[]`
field on the commit arm. `computeVerdict` is unchanged: it still produces a verdict, and
`scanDetailFor` still decides `scan_detail`. What changes is that the gate checks which previously
`return`ed a quarantine now push a finding and fall through.

`recordRescanVerdict` gains the same treatment: a re-scan replaces its version's `scan-flagged` /
`scan-unscanned` / `active-content` findings (the UNIQUE key makes that an upsert) and leaves every
other kind alone, because a re-scan says nothing about the file's type.

`scan_verdict` and `scan_detail` stay on `file_version`. They are the fast path for the listing and
the download gate, and removing them would put a join on the hot read for a value already known. The
finding row is the detailed record; the column is the summary. `scan_detail` stops being the only
home for the `active-content` badge and the unscanned reason.

### 3.4 The type disagreement, recorded

The owner asked that a mismatched file "state what it actually reads as". Three things deliver that,
and all three are needed:

1. **`commitVersionStatement` already writes `sniffed_content_type`.** Once nothing quarantines, the
   sniffed type is recorded for every version by construction — including the over-cap ones, because
   `sniffHead` runs before the size branch.
2. **The disagreement is asserted, not inferred.** A `type-mismatch` finding with
   `expected = "application/pdf"`, `observed = "application/x-msdownload"` says the platform noticed.
   Two populated columns and no finding would leave a reader to re-derive `contentTypesAgree` in
   their head, and the container-equivalence table means they would get it wrong (a legacy Word
   document honestly sniffs as `application/x-cfb`, and that is agreement, not a mismatch).
3. **Both types are on the wire.** The version read model carries `declaredContentType` and
   `sniffedContentType` as separate fields. Today only the sniffed one is exposed.

---

## 4. Access is the gate

`flaggedTreatment` is already the right mechanism and already reads at request time, so a policy
change takes effect on the next request with no re-ingest. What it lacks is coverage: it is enforced
in exactly one route. Extending it is the largest single piece of build work in this design.

**A firm that sets `block` must still get blocking behaviour everywhere.** The file is kept, not
served. That is the promise that makes the reversal safe to ship to firms that want the old posture.

### 4.1 The shared decision

One function, one home, called by every surface below rather than re-derived per route:

```
resolveVersionAccess(version, treatment, { acknowledged }) →
  | { kind: "serve" }
  | { kind: "acknowledge-required"; reason; stepUpRequired }
  | { kind: "blocked"; reason }
```

It exists because three call sites once decided `scan_detail` separately and two of them disagreed
(see the header of `packages/file-manager/src/verdict.ts`); the same failure mode is available here
and is worse, because the thing being decided is whether malware leaves the building.

### 4.2 Download — extend, do not rewrite

`routes/files.ts` already implements the three-way treatment, the 403 for `block`, the 409 for
`informed-access`, the `stepUpRequired` seam, the `file.download_blocked_flagged` audit row and the
`file.downloaded_malware_acknowledged` override row. It moves onto `resolveVersionAccess` unchanged
in behaviour.

**One thing this route cannot do, and the design should not pretend otherwise:** it hands back a
presigned R2 URL. Once minted, that URL is a bearer capability for its TTL that the platform cannot
revoke. The gate is at mint time only. `informed-access` therefore means one acknowledged mint per
download, not continuous control over the bytes.

### 4.3 Preview

`decidePreview` already refuses inline media for a flagged version and degrades to `download-only`
with a `downloadUrl`. Under `block` that URL is a dead link — the download route will 403 it. The
grant must consult the treatment and return a refusal rather than a link that cannot work.

Under `allow-and-flag` the current behaviour is arguably too strict, but it should stay: inline
rendering hands bytes to the browser with a Content-Type the platform chose, and the preview host's
whole safety argument is that only positively-`playable` media with a validated sniffed type ever
reaches it. A flagged file is not the case to relax that on.

### 4.4 Offline checkout and the editor — the two unguarded byte paths

Both are gaps today, and both are worse than the download gap because neither surfaces a warning.

- **`POST /api/v1/files/{fileId}/checkouts`** reads `getCurrentCleanVersion` and returns a presigned
  GET. It is a download by another name, with no verdict check at all. It takes the same three-way
  treatment as `/download`, including the acknowledgement.
- **The editing session launch** (`edit-session-route.ts`) reads `getFileWithCurrentCleanVersion` and
  materializes a working copy from the current version's bytes. WOPI `GetFile` refuses `flagged`
  (`wopi-routes.ts`), so the editor fails _after_ the session exists rather than refusing to open —
  a worse experience and a wasted session. The launch takes the gate; under `block` it refuses,
  under `informed-access` it requires the acknowledgement, and under `allow-and-flag` the WOPI check
  relaxes to match so the two halves agree.

### 4.5 Bulk bundles — the path with the least informed consent

`listCleanCurrentVersionsByMatter` carries no verdict predicate, so a matter's ZIP includes flagged
current versions today. A paralegal extracting a bundle onto a workstation is the least-consented way
for known-bad bytes to leave the platform, and the bundle is content-addressed and cached, so the
decision is baked into an artifact that outlives the request.

- **`block`** — flagged entries are excluded, and the response **names the exclusion count**. A
  silently short bundle is a discovery hazard: a production that omits a document without saying so
  is a certification problem, not a convenience problem.
- **`informed-access`** — inclusion requires the acknowledgement on the request. **AC7** covers
  whether that is one acknowledgement per request or one per file.
- **`allow-and-flag`** — included, and the bundle's contents manifest names each flagged entry.

The manifest hash must incorporate the treatment and the acknowledgement, or a `block` firm and an
`allow-and-flag` firm would share a cached artifact.

### 4.6 What is deliberately not gated

- **The hash and integrity tool** (`routes/file-integrity.ts`). It reads bytes to digest them; it
  parses nothing. It is precisely the tool somebody triaging a flagged file wants, and gating it
  would mean a firm cannot verify the file it is being warned about.
- **Metadata reads** — the listing, the detail read, the version history, the findings themselves.
  Nothing about a flagged file's existence is hidden from anyone who can see the matter. That is the
  point of keeping it.
- **The storage, tiering and reconciliation sweeps.** They never serve bytes.

### 4.7 Future gate points, named now

- **The client portal** (unbuilt). A `PortalGrant` is a version-pinned share to an external party;
  it must take the same gate, and an external recipient should never reach a flagged version under
  any treatment. This is a stronger rule than the internal one and belongs in the portal's own spec.
- **Conversion.** Today `POST /api/v1/conversions` takes a fresh upload under the `conversions/`
  prefix and never reads a `file_version`, so there is nothing to gate. A "convert this document"
  entry point would create one.
- **OCR** — same shape as conversion.

### 4.8 Document templates

A firm-supplied template is a user upload, and `document_template_version` has its own quarantine at
registration (`quarantineTemplateVersionStatement`). The consistent reading of the ruling is that a
template is kept too. The gate is at _use_: a flagged template version can never be selected for an
assembly job, because a firm's letterhead rendered from bytes that carry a signature match is not a
document the firm can send. Refusing to use is not refusing to keep. **AC4** covers whether
`allow-and-flag` should be permitted to override even that.

---

## 5. The analysis surface

The owner's ask:

> "a file manager analysis screen somehow that will list all potential issues in a file, ranging from
> security/safety issues, to file type mismatches, and other potential errors"

Once nothing is refused, this is the screen a firm triages what it holds on. It is not a nice-to-have
beside this change; it is the surface that makes the change survivable, because it is the only place
a firm can see the pile it is now keeping.

### 5.1 Where it lives

A tab on the matter's Files surface — `/matters/[id]/files/analysis` — beside the file table, not in
settings and not behind a per-file modal. Triage is a list operation over a matter's holdings: the
question is "what in this matter needs attention", not "what is wrong with this one file". The
per-file answer lives in the file's detail panel and reads from the same table.

The tab carries a count badge by category, so the surface announces itself rather than waiting to be
found. A matter with no findings shows the tab with no badge, not a hidden tab — an empty triage list
is a fact worth stating.

A firm-wide roll-up across matters is a natural second step and is deliberately not in this design:
it is a cross-matter read, so it inherits ethical-wall questions that the matter-scoped view does
not.

### 5.2 What it lists

One row per finding, grouped by category in the order `safety`, `integrity`, `type`, `policy`,
`processing`. Per row:

- file name and folder path, linking into the file
- version number, and whether it is the current version
- the finding: category chip, kind, and the human sentence built from `kind` + `detail`
- **the two sides**, where the finding has them — "declared `application/pdf`, reads as
  `application/x-msdownload`" is the sentence the owner asked for, rendered from `expected` and
  `observed`
- who uploaded it and when; size; the scan engine version that judged it, where one did
- the action set the firm's treatment permits: download, acknowledge-and-download, or blocked with
  the reason

Filters: category, kind, current-version-only versus all versions, and a date range. Default:
current versions only, all categories — a superseded version's findings are history, and leading with
them buries the live problem.

### 5.3 What the read costs

The naive query joins `file_version_finding` → `file_version` → `file` and filters on
`file.matter_id`. A matter with 200,000 versions and 300 findings would walk the wrong table first.
`matter_id` is denormalized onto the finding row for exactly this reason — the same move
`index_split` makes with `matter_id` as provenance — so the page reads one table on
`(matter_id, category, created_at, id)` and joins out only for the rows on the page.

- **Page read:** one indexed keyset scan over the finding index, plus a bounded join to
  `file_version` and `file` for the page's rows. Independent of corpus size.
- **Badge counts:** `COUNT(*) GROUP BY category` over the same index prefix, bounded by the number of
  findings in the matter, not by its versions. If a matter can accumulate findings in the tens of
  thousands, this becomes a maintained counter rather than a count — measured against the load-profile
  harness before deciding, per golden rule 10, not guessed at now.
- **The file table's finding count** (the badge on a row in the ordinary file list) is a correlated
  subquery on the display version. One page is fifty rows against a UNIQUE index. A denormalized
  column on `file_version` is the fallback if the harness says otherwise, and is not taken up front
  because a denormalized count is a value that can drift and this one has no natural repair pass.

### 5.4 What data exists today, and what does not

**Exists.** `scan_verdict`, `scan_detail`, `scan_engine_version`, `declared_content_type`,
`sniffed_content_type` (on committed versions), `content_sha256`, `size_bytes`, `inline_playable`,
`reconciliation_status`; the `scan_cache` raw result keyed by content hash and engine version (the
richest safety data the platform holds — every YARA match with its tier and score, the clamd state,
the heuristic, the per-leg timings); and the audit trail (`file.version_committed`,
`file.quarantined`, `file.version_rescanned`, `file.download_blocked_flagged`,
`file.downloaded_malware_acknowledged`).

**Does not exist.**

- Any per-version finding record. The gate reasons exist only as a transient `scan_detail` string on
  rows nobody can reach, and as a telemetry event whose field allowlist deliberately has no slot for
  anything identifying — so the rates are observable and the instances are not.
- The declared-versus-sniffed pair as an _assertion of disagreement_ on a committed version.
- Anything at all for a version that committed under a gate that did not fire — which is every
  version in every firm today.
- Processing failures as file-level findings. Extraction and OCR outcomes live on job rows and on
  `review_document.index_state`; a conversion failure lives on the conversion job. Surfacing them as
  `extraction-failed` findings is what makes the screen cover the owner's "other potential errors"
  rather than only the safety half. This is the one part of the surface that needs a new write from a
  subsystem other than ingest.
- Individual YARA matches per version. The `scan_cache` holds them by content hash, so the surface
  can join through `content_sha256` + `scan_engine_version` to show the full match set behind a
  `scan-flagged` finding without storing it twice. Worth doing; it is the difference between "flagged"
  and "flagged by these three rules at these scores".

---

## 6. Malware, plainly

The owner accepted holding the file. The design should make holding it safe rather than pretend it
is inert, so this section states the position without softening it.

**What is now true.** A firm's R2 bucket will hold objects with live ClamAV signature matches. Under
`informed-access` or `allow-and-flag`, a member can obtain those bytes through a presigned URL. Under
`block` they cannot, but the bytes are still there, still metered, still backed up, and still counted
in the firm's storage bill.

**What contains it.**

- R2 objects are inert at rest. Nothing in the platform executes an uploaded file.
- A flagged version is never rendered inline. The preview host serves only positively-`playable`
  media with a validated, header-safe sniffed type, and `decidePreview` refuses `flagged` before any
  of that.
- Every parser that touches version bytes is either a Container with outbound networking disabled or
  memory-safe WASM. Golden rule 14 is the reason that is true today and the reason it must stay true.
- The gates in section 4, once built, are the complete set of paths by which bytes leave.

**What does not contain it, and should be said out loud.**

- A presigned URL is a bearer capability the platform cannot revoke inside its TTL.
- Under `informed-access` and `allow-and-flag`, known-bad bytes land on the firm's own workstations.
  That risk transfers to the firm's endpoint protection, and no amount of platform design changes it.
  The `file.downloaded_malware_acknowledged` audit row is the record of who took it and when, and
  that record is the honest deliverable — not a claim of containment.
- A bulk bundle is the least-consented path, which is why section 4.5 refuses to let a flagged entry
  in silently under any treatment.

**The sweep, and why it blocks.** Today nothing re-examines the corpus. The weekly re-scan cron is
described in the File Manager notes and is not attached — `wrangler.jsonc` carries three triggers and
none of them is it, and `listUnscannedCommittedVersions` has no caller. The only re-examination is
`maybeEnqueueRescanOnAccess`, which fires on download and preview and only when a
`fileManager.scanEngineVersion` is recorded. A file nobody opens is never looked at again.

That is tolerable today because a flagged file never committed. It is not tolerable after this
change, and it is not a follow-up:

1. **Wire the sweep.** It needs a Cron slot, and the trigger set is contended — the notes in
   `wrangler.jsonc` record that the schedule write is one atomic call, so a malformed expression
   refuses the whole set, and that `0 4 * * 0` is malformed for Cloudflare's parser (Sunday is `1`).
   `claude/cron-trigger-cap` is in flight on exactly this. The re-scan is a rider on the existing
   daily pass if no slot is available; the point is that it runs, not that it runs weekly.
2. **Widen what it enumerates.** `listUnscannedCommittedVersions` selects `scan_verdict = 'unscanned'`.
   It must also enumerate `flagged` versions whose `scan_engine_version` is behind the firm's current
   engine — a signature database update is exactly when a previously-flagged file may turn out clean,
   or a previously-clean one may not.
3. **A committed flagged version must be re-judgeable in both directions.** `recordRescanVerdict`
   already accepts `clean`, so a false positive can be cleared. The finding row is replaced by the
   same upsert.

**Purge: nothing is ever purged, and that is the decision.** No sweep deletes a flagged object, no
retention rule expires one, and no engine verdict triggers a destruction. The only removal is a
member's own act — a soft-delete of the file, which leaves the version rows and the objects untouched
— and the existing hold-blocked destruction path. This follows directly from the ruling and from
ADR-0081's standing rule that quarantined files are never auto-deleted because they are evidence. The
consequence to accept is that a firm can host malware indefinitely, at its own cost, and the platform
will keep telling it so on the analysis screen.

---

## 7. Migration

Existing `quarantined` rows fall into two populations that must not be treated alike.

### 7.1 Ingest quarantines — rehabilitated

`scan_detail` in `{type-mismatch, size-mismatch, policy-size, policy-type, scan-flagged}` or a scan
reason string. For these, the object at the key is exactly the bytes the uploader sent, nothing was
ever measured, and these are precisely the files the ruling says should have been kept.

**Rehabilitation re-runs ingest.** The re-drive machinery exists —
`redriveStrandedPendingVersions` already synthesizes an R2-event-shaped message for a stuck version —
but it keys on `status = 'pending'`. The sweep flips `withdrawn`-from-ingest rows back to `pending`
and re-enqueues; the consumer measures, commits, meters, becomes current where the monotonic bump
allows, and writes its findings.

Four things make this safe, and each is worth checking during the build:

1. **It is not a mutation of a committed version.** The immutability invariant binds committed
   versions. These rows have `committed_at IS NULL` and NULL size, hash and sniffed type. The sweep
   completes a version that never finished; it does not edit one that did.
2. **Ordering is correct by construction.** `bumpFileCurrentVersionStatement` is monotonic on
   `version_number`, so a rehabilitated v1 landing after a clean v2 leaves the pointer at v2. A
   rehabilitated version only becomes current if it genuinely is the newest.
3. **The meter self-corrects into consistency.** These bytes are unmetered at commit today and get
   swept in by the daily reconciliation as drift. Rehabilitation meters them in their own commit
   batch, which removes a standing source of reconciliation drift rather than adding one.
4. **Idempotency holds.** The commit rides `runIdempotentEffect` keyed `ingest:<versionId>`; a
   version that already rehabilitated re-runs as a no-op.

**It is per-firm and audited, not a silent global backfill.** A document appearing in a matter's file
list — and in the next bulk bundle — months after the firm was told it was rejected is a surprise, and
surprises are what a system of record exists to prevent. **AC3** settles whether the firm initiates
it or the platform runs it on deploy with notice.

The rehabilitation writes one audit row per version and one notification per matter, not per file: a
firm with two thousand rehabilitated documents should get one message saying so, with a link to the
analysis screen.

### 7.2 Custody withdrawals — not rehabilitated

`scan_detail` of `content-drift` or `content-unverifiable`. These stay withdrawn. Nothing about them
was a content judgment, the object no longer matches what the row asserts, and re-committing would
put a verdict on bytes nothing inspected. They keep a `content-drift` finding so they appear on the
analysis screen with an honest explanation, which is more than they get today.

### 7.3 Schema and contract

- The `file_version_finding` table, additively, per the expand-contract rule.
- The `file_version_status_check` widening, the data migration, and the eventual contraction (2.2).
- **A breaking API contract change.** `status` on the file read models changes from
  `clean | pending | quarantined` to `committed | pending | withdrawn`, and `FileListItem` gains
  `findingCount`. The OpenAPI snapshot and the generated client regenerate in the same commit;
  `documentStatusPresentation` and `hasReadableContent` in `apps/web` both switch on the old strings
  and must move with it.
- New routes: `GET /api/v1/files/{fileId}/versions/{versionId}/findings` and
  `GET /api/v1/matters/{matterId}/file-findings`. Both are `files:*` capabilities and therefore bind
  `resource: "matter"`, per the worker's local rule.

---

## 8. Invariants

Read against [`docs/conventions/invariants.md`](../conventions/invariants.md) and the File Manager's
own `CLAUDE.md`.

### Touched, and rewritten by this design

- **"The quarantine gate is a status gate enforced by reads."** The gate stays — `pending`,
  `withdrawn` and `abandoned` versions remain unservable, and the fitness function that rejects a
  `file_version` SELECT without a status predicate is unchanged and is the tool that makes the rename
  in 2.2 tractable. What changes is the second half of the sentence: a committed version's **findings
  gate access, not storage**. The invariant is restated as two: _every `file_version` read filters
  the lifecycle status_, and _a committed version's safety findings are enforced at every path that
  reaches its bytes_. The second one is new and needs a fitness function of its own — a source scan
  that fails any route resolving a version's `r2_key` for delivery without going through
  `resolveVersionAccess`. Without it, section 4's coverage decays the first time somebody adds a
  route.
- **"A version-lifecycle batch is all-or-nothing."** Unchanged in substance; the finding inserts join
  the batch behind `assertVersionStatusStatement` like every other consequence.

### Adjacent and deliberately not touched

- **"Versions are immutable; soft-delete only."** Not violated, including by the migration — see
  7.1(1). The rehabilitation sweep must not be written in a way that could touch a row with
  `committed_at` set, and that guard belongs in the statement's WHERE clause, not in a comment.
- **"A verdict binds to bytes, not to a key."** Strengthened. The custody withdrawal becomes the only
  producer of a non-committed state after commit, which makes it easier to reason about, not harder.
- **"R2 keys are opaque and server-minted."** Untouched.
- **Golden rule 3, firm-scoped data access.** `file_version_finding` is a per-firm table read through
  the data-access layer like everything else.
- **Golden rule 4, redact by default.** Binding on the new table, and 3.2 states the constraint
  concretely rather than deferring to the standard.
- **Golden rule 14, memory-safe languages.** Binding on every parser that now sees more untrusted
  bytes than it did. It is not weakened by this change, but it becomes load-bearing in more places.
- Money, trust, encryption, `protected()`, and SSRF invariants: not touched. No finding column is a
  protected field, and nothing here makes an outbound request.

### Nothing in the ruling requires violating a hard invariant

The one place the design does not follow the ruling literally is the **custody withdrawal** (2.4). A
version whose object has been swapped is un-committed, and it is the only surviving path that does
that. It is not a narrowing of the ruling: the ruling is about a file a user uploaded, and this is
the discovery that the row no longer describes the bytes anyone uploaded. The closest thing to
keeping everything is AC6 — capture the replacement bytes as a new version rather than describing
them in a string — and that is offered rather than assumed.

---

## 9. Owner flags

**AC1 — the default `flaggedTreatment` for a newly committed flagged file.** Today it is `block`,
chosen to preserve the pre-existing behaviour. Under always-commit, `block` means kept, listed,
named on the analysis screen, and never retrievable by anyone — not downloadable, not previewable,
not checkoutable, not editable, excluded from bundles. That is the most conservative reading of the
ruling and it is still a large change from today, where the file does not exist at all.
`informed-access` means a member can always get their file back after an acknowledgement that is
audited. The recommendation is **`informed-access` as the new default**, because "it is up to the
user to deal with the file" is not satisfied by a file they can see and never touch — but this
changes the risk posture of every firm on the platform at once, and it is the owner's call. A firm
that wants the old posture sets `block` and gets it everywhere, which is what section 4 is for.

**AC2 — is it acceptable to index a flagged document's text?** Extraction hands the bytes to the
WASM PDF engine and writes derived text into a searchable split in R2, and, where the firm has
enabled it, into the natural-language feed. For: a firm that holds a document should be able to find
it, and the extractor is memory-safe Rust. Against: extraction is precisely "hand untrusted
privileged bytes to a parser", and the derived text leaves the object boundary. The recommendation is
**metadata-only indexing for a flagged version** — name, dates, uploader, type, so it is findable —
with text extraction reserved for `clean`, `unscanned` and `active-content`. This mirrors what
discovery already does with `scanVerdictAdmitsParsing`.

**AC3 — is the rehabilitation of already-quarantined versions automatic on deploy, or firm-initiated?**
Recommendation: firm-initiated, from the analysis screen, with a preview of what would return.

**AC4 — does always-commit extend to document templates?** Recommendation: yes, keep them, and gate
at use — a flagged template version is never selectable for assembly under any treatment, because a
firm's letterhead has one appearance and it is not one rendered from bytes carrying a signature
match. Confirm that `allow-and-flag` does not override this.

**AC5 — is there a storage quota, and does a full firm stop being able to upload?** There is none
today. Once nothing is refused for content, capacity is the only structural refusal left and the
platform has no answer for it. The meter is exact and in D1, so a presign-time check is cheap.
Recommendation: adopt one, refuse at presign, and never refuse a commit for it — refusing a commit
loses the record while keeping the storage, which is the failure this whole change exists to remove.

**AC6 — on a custody drift, should the replacement bytes be captured as a new version** (a
server-side copy to a freshly minted key) rather than only described in a `scan_detail` string?
Recommendation: yes, subject to the ~5 GiB single-copy ceiling, above which the honest fallback is
the current behaviour plus a finding that says so.

**AC7 — under `informed-access`, does one acknowledgement cover every flagged file in a bulk bundle,
or one per file?** Recommendation: one per request, with the bundle's contents manifest naming each
included flagged entry, so consent is informed without being unusable.

---

## 10. Build order

Not an implementation plan — the ordering constraints that plan will have to respect.

1. `file_version_finding` + the identifier handle + the data-access statements. Nothing else can be
   written first, because every later step writes findings.
2. `resolveVersionAccess` and its fitness function, **before** the ingest change. Building the gate
   before removing the refusals means there is never a window where flagged files commit and the
   access paths do not know about them.
3. Extend the gate to checkout, editor launch, preview and bundles. Still before the ingest change.
4. Widen and wire the re-scan sweep (section 6).
5. The ingest change itself: `runIngest` loses its quarantine arm, findings are written in the commit
   batch, `quarantineVersionStatement` and its caller are deleted.
6. The status rename, expand-contract.
7. The findings routes, the contract regeneration, and the SPA's status handling.
8. The analysis screen.
9. The rehabilitation sweep, last, so it lands on a system that can already display and gate what it
   returns.

Steps 2 and 3 are the ones that must not be deferred past step 5. Everything after 5 can ship
incrementally; nothing before it can.
