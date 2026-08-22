# File manager — six open questions, answered against the tree

**Date:** 2026-08-22
**Branch:** `claude/file-manager-unknowns`
**Scope:** six "do we already have this?" questions raised while reviewing a file-manager mockup.
Each is answered from source, with file and line. No product code was changed.

## Why this document exists

A file-manager screen is being designed concurrently. Six of its decisions turn on facts about the
existing platform that nobody had checked: whether an error surface can reuse something, whether the
mockup's "API gap" chip duplicates a system that already exists, what the repository can already say
about a file's type, whether the sniffed-versus-claimed discrepancy is recorded anywhere a screen
could read it, whether `.doc` and `.docx` are properly distinguished, and whether two files with the
same name can lose one in a bulk download.

Where a question could not be settled from here, this document says so instead of guessing.

## One correction before the answers

**The SPA is `apps/web`, not `apps/web-worker`.** `apps/web-worker` holds only a `package.json` and a
`wrangler.jsonc` — it is the deployable wrapper, and `apps/web-worker/src` does not exist. Every
client-side answer below cites `apps/web/src`. The branch `claude/web-worker-split` is in flight and
moving the SPA under that name, so the mockup's path is forward-looking rather than wrong.

## The short answers

| #   | Question                                     | Answer                                                                                               |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Error-reporting framework on the client?     | **Yes, three pieces of one.** Reuse them; do not invent. No error boundary, and no wired submission. |
| 2   | Does "API gap" match Soon/Alpha?             | **It is the same concept and there is a standing owner rule for it.** Reuse the Soon Badge.          |
| 3   | Dependency that types a file by name?        | **No dependency. Two in-repo tables**, both usable; the best one is in the conversion registry.      |
| 4   | Magic-bytes-vs-claimed discrepancy surfaced? | **Detected, then discarded.** The sniffed value is never stored on a quarantined row.                |
| 5   | `.doc` vs `.docx`                            | **Correctly distinguished everywhere it matters** — but only the discovery lane can read a `.doc`.   |
| 6   | Duplicate names / download data loss         | **The data-loss risk is not real.** Dedup already exists. The duplicates themselves are real.        |

---

## 1. Is there an error-reporting framework already?

**Yes — a house pattern in three pieces, all reusable, none of which the file manager should
reinvent.** What is missing is the boundary and the wire, not the surface.

### What exists on the client

**The problem-details reader — `apps/web/src/lib/api/request.ts`.** One `fetch` seam that never
throws and resolves to exactly three outcomes: `ok`, `problem`, and `transport`. Its comment states
the reason the last two are not collapsed into one `catch` — they change what a person should do
about it. `ApiProblem` (line 17) reads `status`, `type`, `detail`, and `errorId` off the body.

**The guidance table — `problemGuidance` at `apps/web/src/lib/documents/document-presentation.ts:83`.**
Maps an `ApiProblem` to `{ tone, title, message }` keyed by HTTP status, preferring the server's own
`detail` where it sent one. It is already what the existing matter Files screen renders
(`apps/web/src/routes/(app)/matters/[id]/files/+page.svelte:64`, into an `Alert.Root variant="warning"`
at line 117).

**The diagnostics block — `apps/web/src/lib/components/error-details.svelte`.** A `select-all`
monospace `<pre>` plus a Copy button, emitting a trace-shaped `key: value` block: build identity,
time, status, path, message, error id, browser. It renders `"not yet assigned"` when the pipeline
supplied no Error ID (line 15). Used by both `+error.svelte` files.

**The crash screens — `apps/web/src/routes/+error.svelte` and
`apps/web/src/routes/(app)/+error.svelte`.** The in-shell one keeps the sidebar and top bar usable
(an error must never strand the user), splits 404 from failure, and offers Retry / Go home /
Go Back. Its failure copy is already close to what the mockup asks for: _"The error has been noted.
Retry, and if it persists, copy the details below into a report."_

**The report affordance — `apps/web/src/lib/components/bug-report-dialog.svelte`.** "Report an Issue",
reachable from the profile menu (`profile-menu.svelte:105`) and the command palette
(`command-palette.svelte:236`) on every screen. Description textarea, collapsible "Included
diagnostics", optional in-office recipients, email-me-a-copy switch, Copy report.

### What the API returns on failure

`problemJson` at `apps/worker/src/contracts/problem.ts:100` emits RFC 9457 with:
`type`, `title`, `status`, `detail`, `errorId` (always — minted if not supplied, line 122),
`correlationId`, `instance`, and optionally `errors`, `requestAccess`, `stepUpRequired`,
`attemptsRemaining`, `retryAfterSeconds`.

**All of it is safe to show.** `detail` is server-authored, never a raw exception: the 500 boundary
(`apps/worker/src/telemetry-middleware.ts:79`) hard-codes _"An unexpected error occurred. Quote the
Error ID when reporting it."_ and logs only `errorName` plus a truncated `messageHead` server-side.

The client currently drops four fields it is given: `title`, `correlationId`, `retryAfterSeconds`,
and `stepUpRequired`. `retryAfterSeconds` on a 429 and `stepUpRequired` on a flagged-file 409 are both
directly useful to a file manager and cost nothing to start reading.

### What does not exist

- **No error boundary.** No `<svelte:boundary>`, no `hooks.client.ts`, no `onerror` /
  `unhandledrejection` handler anywhere in `apps/web/src`. A thrown component error inside a route
  reaches SvelteKit's `+error.svelte`; a thrown error inside an event handler or an async effect
  reaches nothing.
- **No breadcrumb ring buffer.**
- **No wired submission.** `POST /api/v1/incidents` is fully built
  (`apps/worker/src/routes/incidents.ts:79`, taking `errorIds`, `breadcrumbs`, `description`,
  `context`), and **no client code calls it.** The dialog's Submit button renders disabled with a
  `Soon` badge (line 169-172); Copy is the working carrier.
- **`problemGuidance` is duplicated, not shared.** There are two copies with the same name and
  different bodies: `document-presentation.ts:83` and `whois-lookup.ts:87`. A third surface adopting
  it should lift it to a shared module rather than fork it again.

This matches `docs/conventions/error-logging.md`, which records the client reporter as
**`[→ 0·7a/0·7b]`** — backend built in slice 0·6, UI surfaces inherited by the design-system slice.

### What the file manager should therefore build

Nothing new at the component level. The house pattern, applied to a file-manager error, is:

1. Call through `requestJson`; branch on the three outcomes.
2. Render `problemGuidance(problem)` into `Alert.Root` with the tone it returns.
3. Show the Error ID in the alert when the tone is `danger` — the existing precedent is
   `apps/web/src/routes/(app)/tools/whois-lookup/+page.svelte:127`, which deliberately shows it only
   on a danger tone, so a `501 unsupported` does not read as our fault.
4. Point at the existing "Report an Issue" in the profile menu rather than adding a second report
   entry point.
5. For first steps: Retry and Go home are already the crash-screen actions. "Check your connection"
   belongs on the `transport` outcome specifically, which is the one outcome that means nothing
   answered — the Files screen already words it as _"Nothing answered."_ at line 61.

The one thing worth adding while in the area is the boundary the standard already calls for, so a
component throw inside the file list does not blank the region silently.

---

## 2. Does the "API gap" chip match the existing Soon/Alpha sticker system?

**It is the same concept, the system exists, and there is a standing owner rule that makes reusing it
mandatory rather than optional.** The mockup's chip should be the existing Soon Badge.

### The system

`apps/web/src/lib/maturity/` is the single home, and says so in its own header comment
(`maturity.ts:6`).

- **The model** — `maturity.ts:28`: `type MaturityStage = "soon" | "alpha" | "beta" | "ready"`.
- **The presentation** — `MATURITY_PRESENTATION` at `maturity.ts:39`: `soon` is
  `{ label: "Soon", badgeVariant: "neutral" }`, `alpha` is `{ label: "Alpha", badgeVariant: "info" }`,
  `beta` is `{ label: "Beta", badgeVariant: "success" }`, and `ready` is **`null`** — a finished
  surface wears no mark.
- **The components** — `maturity-badge.svelte` (labelled pill, where there is room) and
  `maturity-dot.svelte` (colour dot, for icon-only chrome).
- **`hasSurface(stage)`** at `maturity.ts:63`: `soon` is the one stage meaning no surface exists yet.

### How maturity is declared

Three registries carry a `stage` field, all reading the same model:

- **Destinations** — `apps/web/src/lib/navigation/destinations.ts:92`, with
  `destinationStage()` at line 96 deriving it from `shipped` when unset. Rendered in
  `app-shell.svelte` (lines 246, 288, 328, 349 for badges; 330, 351, 381, 400, 445 for dots).
- **Matter sections** — `apps/web/src/lib/matters/sections.ts:16`. **The Files section is declared
  `stage: "alpha"`** (line 33).
- **Tools** — `apps/web/src/lib/tools/tool-presentation.ts:35`, rendered by `tool-row.svelte:26` and
  `tool-tile.svelte:31`.

### Why the mockup's chip is not a different concept

There is a second, per-control spelling of the same vocabulary, and it is exactly what the mockup's
"API gap" chip is describing. It is a raw `<Badge variant="neutral">Soon</Badge>` placed on the
individual disabled affordance, and it appears at 20+ sites — `bug-report-dialog.svelte:171`,
`profile-menu.svelte:83/111/118`, `matter-header.svelte:103`, `account/profile/+page.svelte:64/71/78`,
`matters/[id]/costs/+page.svelte:74`, and so on.

It is governed by a standing owner rule, stated twice:

> **Designed-but-unwired UI ships visible and marked "Soon" — never omitted, never fake-live** (owner
> rule, 2026-07-03). When a surface is designed ahead of its backend or machinery, render its final
> anatomy — including the real primary action — with the affordance disabled and carrying the small
> "Soon" Badge device, plus one honest line saying what its arrival waits on.
>
> — `docs/conventions/ui-design.md:75`

and repeated in `docs/conventions/design-corrections.md:67` — where the note explains why it is
repeated: _"it is the one most often skipped."_

**So: reuse it.** Vocabulary is `Soon` / `Alpha` / `Beta` / (nothing). Component is
`Badge variant="neutral"` for a per-control gap, `MaturityBadge` for a whole surface or registry row.
"API gap" is developer-facing language for a user-facing thing the rule already names, and the rule
also requires the part the mockup is missing: **one honest line naming what the control waits on.**

The one genuine gap in the existing system: the per-control Soon badge is hand-rolled at every site
rather than going through `MaturityBadge`, so "Soon" is spelled as a literal 20+ times. If the file
manager introduces many of them at once, routing them through `MaturityBadge stage="soon"` is the
cheap consolidation.

---

## 3. Is there a dependency that identifies file type by name?

**No dependency does this. Two in-repo tables do, and a third dependency does the opposite (content,
not name).** The distinction matters and the repository is unusually disciplined about it.

### Name-based (the repository's own tables — no dependency)

**`packages/conversion/src/registry.ts` — the best source for a Type column.** `FORMATS` is an array
of `{ id, label, mediaType, extensions[] }` with human labels already written for display:
`"Word (DOCX)"`, `"Word 97-2003 (DOC)"`, `"Excel (XLSX)"`, `"WordPerfect"`, `"Outlook (MSG)"`,
`"Searchable PDF"`. 24 formats. `detectFormat` at `packages/conversion/src/file.ts:38` resolves a
`{ name, type? }` descriptor by MIME first, extension second.

**`packages/design-system/src/lib/components/file-icon/resolve.ts` — the coarse one, already shipped.**
`EXTENSION_CATEGORY` at line 103 maps ~70 extensions to 12 categories (`pdf`, `word`, `excel`,
`powerpoint`, `image`, `video`, `audio`, `archive`, `text`, `code`, `email`, `unknown`), and
`CONTENT_TYPE_CATEGORY` at line 69 maps 30 MIME types to the same set. `resolveFileCategory` at line
210 tries content type first, then extension, then returns `unknown`. **This is already what the
matter Files list uses** for its row glyph
(`apps/web/src/routes/(app)/matters/[id]/files/+page.svelte:154`).

### Content-based (the actual dependency)

**`file-type@22.0.1`, pinned in `pnpm-workspace.yaml:82`, a direct dependency of exactly one package:
`packages/file-manager` (`package.json:47`).** It is a magic-byte sniffer, not a name guesser. Used
once, at `packages/file-manager/src/ingest-core.ts:1`, over at most 4 KiB of head bytes
(`sniffHead`, line 89).

Two more content-based engines exist, neither name-driven:

- **Magika** in the scan Container (`containers/scan/src/identify.rs`), whose raw output
  `packages/file-type` maps to a `FileTypeReport`.
- **`crates/discovery-core/src/identify.rs`**, whose module header is worth quoting because it is the
  house position: _"The file name is evidence, never authority… identification here reads bytes and
  nothing else: `identify` cannot be handed a name, which makes 'identified by extension' a thing
  this module has no way to do."_

### What the lockfile actually contains

`mime-types@2.1.35` and `mime-db@1.52.0` are present but are **transitive test/tooling dependencies
only** — pulled in by `accepts`, `type-is`, and `postman-collection`. No workspace package declares
either. `file-type@3.9.0` is likewise transitive, via `postman-collection`. **Adding a name-to-type
dependency is not necessary**, and would be a third table where two already exist.

### Recommendation for the Type column

Reuse `packages/conversion`'s `FORMATS`, which already carries display labels, and fall back to
`resolveFileCategory` for the coarse family. `packages/file-type/src/labels.ts` is the wrong source
here — it is keyed by **Magika label**, not by extension, and only fires when the scan Container has
identified the bytes.

---

## 4. Magic bytes versus claimed type — where is the discrepancy recorded, and is it surfaced?

**The comparison happens at ingest and is real. What is stored afterwards is one kebab-case token and
nothing else — the sniffed value that caused the mismatch is never written to the row.** A screen
cannot say "this file says A but its bytes say B" from the data the platform keeps today.

### What is compared against what

**Sniffed magic bytes versus the client's `declaredContentType`** — not versus the filename extension.

- `packages/file-manager/src/ingest-core.ts:192` sniffs the head bytes into `sniffedContentType`.
- `ingest-core.ts:245`: `if (!contentTypesAgree(sniffedContentType, input.version.declaredContentType))`
  → `{ kind: "quarantine", reason: "type-mismatch", scanDetail: null }`.
- `contentTypesAgree` lives in `packages/file-manager/src/content-type-equivalence.ts:103`. It is not
  string equality, deliberately: a magic-byte sniff names the **container**. Every pre-2007 Office
  file reports `application/x-cfb`, and an OOXML file often reports bare `application/zip`. The file
  holds two explicit allow-list tables — `COMPOUND_FILE_MEMBER_CONTENT_TYPES` (line 43) and
  `ZIP_MEMBER_CONTENT_TYPES` (line 64) — and every pair outside them fails closed.

The declared type comes from the browser's `File.type` at
`apps/web/src/lib/documents/create-document.ts:107`. Three server-side producers deliberately declare
nothing: archive expansion (`archive-expansion.ts:193`, with the reason written out — the entry's
name inside an archive is the other side's claim), offline check-in
(`checkout-routes.ts:441`), and in-app version cuts. `contentTypesAgree` returns `true` when either
side is null (line 106), so those never quarantine on type.

**Nothing compares the sniffed type against the filename extension at ingest.** The extension is
checked separately and only against a blocklist (`upload-policy.ts:213`).

### What is stored

This is where the discrepancy is lost.

`quarantineVersion` (`packages/file-manager/src/file-service.ts:857`) writes
`quarantineVersionStatement(database, input.versionId, input.scanDetail ?? input.reason)`. For a type
mismatch `scanDetail` is `null`, so the literal string `"type-mismatch"` lands in `scan_detail`. The
statement itself (`file-statements.ts:345`) is:

```sql
UPDATE file_version SET status = 'quarantined', scan_detail = ?2 WHERE id = ?1 AND status = 'pending'
```

**`sniffed_content_type` is never written on this path.** The column exists
(`per-firm-schema.ts:878`) and so does `declared_content_type` (line 877), but only
`commitVersionStatement` writes the sniffed value (`file-statements.ts:262`), and a quarantined
version never commits. So a quarantined row carries the **declared** type and a NULL **sniffed**
type. The value that triggered the refusal is gone the moment the ingest function returns.

The telemetry event does not preserve it either: `ingestVerdict` at `ingest-consumer.ts:237` carries
`outcome`, `scanVerdict`, `scanDetail`, and `quarantineReason` — no content types, by design (the
allowlist has no slot for them).

### What is surfaced

The token reaches the UI verbatim.

- `packages/file-manager/src/queries.ts:104`:
  `quarantineReason: status === "quarantined" ? row.scan_detail : null`.
- `apps/worker/src/routes/files.ts:496` projects it onto `FileSummary`.
- `documentStatusPresentation` (`document-presentation.ts:52`) returns
  `{ label: "Rejected", variant: "danger", detail: document.quarantineReason }`.
- The matter Files screen renders it at
  `apps/web/src/routes/(app)/matters/[id]/files/+page.svelte:165-167` as a plain muted line under
  a red Rejected badge.

**So a person today sees a red "Rejected" chip and the literal text `type-mismatch`.** No human
wording, and no naming of either type.

### The one place the discrepancy IS expressed well — and it is not wired

`packages/file-type/src/report.ts` builds exactly the sentence the owner is asking for. Line 56:

```
`Named ".${claimedExtension}", but the content is ${detectedLabel}. Consider .${recommendedExtensions[0]}`
```

Four verdicts (`match` / `mismatch` / `no-extension` / `unverifiable`), and it compares **extension
against Magika's content label** — the more useful comparison, and a different one from ingest's.
It is served by `POST /api/v1/file-type/verify` (`apps/worker/src/routes/file-type.ts:45`).

Two things block it: the route returns `503` unless `SCAN_SERVICE` is connected
(`file-type.ts:113`), which is a deploy-time activation, and the tool's UI stage is `"soon"`
(`tool-presentation.ts:86-89`) — there is no page.

### What is available to show, and what is not

| Fact                                        | Available today?                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| That a version was refused for a type lie   | **Yes** — `quarantineReason === "type-mismatch"` on `FileSummary`            |
| The declared type on a quarantined version  | **In D1** (`declared_content_type`), **not** on any API response             |
| The sniffed type on a quarantined version   | **No** — never written                                                       |
| The sniffed type on a **committed** version | **Yes** — `FileSummary.sniffedContentType`                                   |
| The declared type on a committed version    | **In D1**, not on any API response                                           |
| An extension-versus-content verdict         | Only via `/api/v1/file-type/verify`, on demand, engine not deployed, no page |

**A committed version never carries a genuine disagreement**, because a disagreement quarantines. What
it can carry is a benign container-level difference — `application/x-cfb` sniffed against
`application/msword` declared — which is a true "says A, bytes say B" but is not a problem and should
not be presented as one.

**Making the discrepancy visible is cheap, and the cheap part expires.** Two changes, both in the
"build when in the area" category:

1. Pass `sniffedContentType` into `quarantineVersion` on the `type-mismatch` branch and store both
   sides — e.g. `type-mismatch: declared application/pdf, sniffed image/jpeg`. This is a one-line
   change at the call site and the reason to do it now is stated in the code's own comment
   (`file-service.ts:872`): _"a reviewer opening a quarantined version months later has only this
   column."_ Today that column tells them the category and nothing else.
2. Project `declaredContentType` onto `FileSummary` alongside the sniffed one.

Neither is a file-manager-screen change, but both are prerequisites for the screen showing what the
owner asked for.

---

## 5. Legacy formats: `.doc` and `.docx`

**They are correctly distinguished everywhere a distinction is made, and nothing treats them as
interchangeable. The gap is narrower and different from what the question anticipated: only the
discovery lane can actually read a `.doc`, and the container that does it is not deployed.**

### They are distinct in every registry

**Conversion registry** (`packages/conversion/src/registry.ts`): separate nodes with separate media
types and labels — `docx` / `application/vnd.openxmlformats-officedocument.wordprocessingml.document`
/ `"Word (DOCX)"` (line 11) and `doc` / `application/msword` / `"Word 97-2003 (DOC)"` (line 32). The
comment above the legacy block states the rule:

> They are SOURCES ONLY — there is an edge out of each and none back in, because writing a 1997 binary
> format is not something anybody should be helped to do, and the reason these are here at all is that
> a production received from another party is full of them and nothing memory-safe reads them.

There is one edge, `doc → docx`, engine `libreoffice` (line 115), described as _"the ONLY route the
platform has into a 1997 binary office file."_ Matching edges exist for `xls → xlsx` and `ppt → pptx`.

**Discovery identification** (`crates/discovery-core/src/identify.rs`): `LegacyWordDocument` and
`OfficeOpenXmlDocument` are separate variants of `IdentifiedFormat` (lines 27, 38), resolved from
different evidence — the OLE2 `WordDocument` stream (line 285) versus the OOXML `word/document.xml`
part. The OLE2 subtyper (lines 265-297) also separates `.msg` (MAPI property streams),
`.xls` (`Workbook`/`Book`), `.ppt` (`PowerPoint Document`), and an encrypted OOXML wrapper, before
falling back to a generic `CompoundFile`.

**Design-system icons** (`file-icon/resolve.ts`): both `doc` and `docx` map to the `word` category
(lines 105-106) and share a glyph. **This one is correct** — a glyph names a family, not a format.

### The extraction path handles legacy properly

`crates/discovery-core/src/extract/mod.rs:162` routes all three legacy binaries to
`ExtractionOutcome::NeedsConversion` rather than failing. `apps/worker/src/search/text-extraction.ts`
picks that up: `LEGACY_CONVERSION` at line 133 maps `legacyWordDocument → { from: "doc", to: "docx" }`,
and `convertThenRead` (line 435) converts, then re-reads with the pure-Rust engine, with a hop cap
(line 442) so a conversion that itself needs converting fails cleanly instead of looping.

### Nothing treats them as interchangeable

The ingest gate's equivalence table is the one place the two families meet, and it is careful:
`application/msword` is in `COMPOUND_FILE_MEMBER_CONTENT_TYPES` (line 44) and the OOXML Word type is
in `ZIP_MEMBER_CONTENT_TYPES` (line 66). They are in **different** tables with **different**
container signatures, so a `.doc` declared as a `.docx` still quarantines.

### The real gap

**Only the discovery/search lane can read a `.doc`.** Everything else either cannot or is not wired:

- **`packages/conversion` has no production caller.** `detectFormat`, `availableTargets`, and
  `convertFile` (`file.ts:38/54/69`) are referenced only from `text-extraction.ts` via the lower-level
  `runConversion`. There is no file-converter surface. A "Convert to PDF" action in the file manager
  is an API gap in the Soon sense.
- **The LibreOffice engine is deferred.** The `officeEdges` block is annotated as such, and
  `packages/conversion/src/engines.ts` distinguishes implemented from deferred bodies. Until the
  office Container is deployed, the `doc → docx` edge returns `engine-not-implemented`, which
  `text-extraction.ts:447` parks rather than fails.
- **The metadata scrubber cannot touch a `.doc`.** `packages/metadata/src/detect.ts:3` supports
  exactly `"docx" | "jpeg" | "png"`.
- **The document-assembly engine is OOXML-only.** `TemplateKind` is `"wordProcessing" | "pdfForm"`
  (`packages/document-assembly/src/types.ts:43`), and `wordProcessing` means a `.docx` package the
  engine walks part by part. A firm cannot register a `.doc` as a template. This is correct — there is
  no memory-safe way to rewrite a 1997 binary — but it is a fact a migrating firm will meet.
- **No editability gate by content type exists at all.** Nothing in `apps/worker/src/editing/` or
  `packages/file-manager/src` maps a content type to "can be opened in the editor". A file-manager
  Edit action has nothing to ask.

### The consequence for a Type column

**Every legacy Office file's `sniffed_content_type` is the string `application/x-cfb`** — `.doc`,
`.xls`, `.ppt`, `.msg`, `.vsd`, `.mpp`, all of them. This is stated in
`content-type-equivalence.ts:8-11` and is a property of the format, not a bug.

A Type column driven off `sniffedContentType` alone would therefore render a firm's entire pre-2007
archive as one indistinguishable blob. The extension is the only thing that separates them at that
point, which is why `resolveFileCategory` tries content type first **and then falls back to the
extension** — `application/x-cfb` matches nothing in `CONTENT_TYPE_CATEGORY`, no `image/`, `video/`,
`audio/`, or `text/` prefix, so it returns `undefined` and the extension decides. That fallback is
load-bearing for legacy files specifically, and any new Type-column logic must keep it.

---

## 6. Duplicate names

**The data-loss risk on download is not real — the de-duplicating rename the question asks about
already exists and has since the bulk-download resolver was written. The duplicate names themselves
are real, and there are producers that generate them deterministically.**

### Folder names: the constraint exists, with two holes

`packages/database/src/per-firm-schema.ts:805`:

```
unique().on(table.matterId, table.parentFolderId, table.name)
```

with the schema's own comment (line 803) naming the first hole: _"SQLite treats NULLs as distinct, so
this backstops sibling-name collisions for non-root folders; the folder service enforces the
root-level (null-parent) case as well."_

The application check is `assertNameAvailable` at `packages/file-manager/src/folder-service.ts:54`,
called from `createFolder` (line 95), `renameFolder` (line 127), and `moveFolder` (line 187). It
raises `folder-name-taken` (`validation.ts:10`). The underlying query
(`folder-statements.ts:82`) branches on null and uses `parent_folder_id IS NULL` for the root case.

**Hole 1 — the matter root has no database backstop.** For `parent_folder_id IS NULL`, the UNIQUE
index does not apply, so only the read-then-write check in the service protects it. D1 has no
interactive transactions (stated in the package's own gotchas), so two concurrent root-level "New
Folder" creations can both pass the SELECT and both commit. This is the single place in the folder
tree where the observed behaviour is genuinely reachable.

**Hole 2 — the comparison is exact and untrimmed.** `name = ?2` under SQLite's default BINARY
collation is case-sensitive, and `requireUsableName` (line 48) only checks that `name.trim()` is
non-empty — the untrimmed value is what gets stored. So `Contracts` / `contracts` / `Contracts ` are
three permitted siblings.

### File names: no constraint anywhere

The `file` table (`per-firm-schema.ts:813-860`) carries **no** unique index. Its only name rule is
`check("file_name_nonempty_check", sql\`length(name) > 0\`)` at line 858.

`FileManagerValidationCode` (`validation.ts:3-38`) has a `folder-name-taken` code and **no**
`file-name-taken` code — the absence is structural, not an oversight in one code path.

Route validation is `z.string().min(1)` (`uploads.ts:57`) and `z.string().min(1).optional()` for
rename (`files.ts:142`). No character restrictions, no trim, no `/` rejection.

### What the copy path actually does

**There is no copy path.** No `/api/v1/files/{id}/copy`, no `copyFile`, no duplicate action in
`packages/file-manager/src/file-service.ts` or `apps/worker/src/routes/files.ts`. Every use of
`copyObject` in the file service is a **version** operation on one file — `commitEditedVersion`
(line 750) and `restoreVersion` (line 1115) — never a new sibling row.

The string "New Folder" does not appear anywhere in `apps/web/src`, and the web app has no folder UI
at all (`folderId` appears only as a field on `DocumentSummary`). **Both behaviours the owner observed
are mockup behaviours, not product behaviours.**

### But duplicates are real, from five producers

Five call sites create files, and **none checks for a sibling with the same name**:

| Producer                                              | Name source                    |
| ----------------------------------------------------- | ------------------------------ |
| `apps/worker/src/routes/uploads.ts:432`               | whatever the client sends      |
| `apps/worker/src/emails/attachment-extraction.ts:143` | the attachment's filename      |
| `apps/worker/src/assemblies/assembly-consumer.ts:563` | `assembledDocumentName(...)`   |
| `apps/worker/src/discovery/archive-expansion.ts:184`  | `entryDisplayName(child.path)` |
| `apps/worker/src/routes/file-repair.ts:238`           | the salvaged file's name       |

Two of these produce duplicates deterministically:

- **Assembly.** `assembledDocumentName` (`assembly-consumer.ts:247`) builds
  `` `${templateName} - ${matterLabel}.${extension}` ``. Assembling the same template on the same
  matter twice yields two file rows named identically. This is the closest thing in the built product
  to "copying a file twice", and it is reproducible.
- **Archive expansion.** `entryDisplayName` (`archive-expansion.ts:155`) takes only the last path
  segment, so `2024/invoice.pdf` and `2025/invoice.pdf` inside one archive both become `invoice.pdf`.

### Is a bulk download of two identically-named files lossy? No.

`packages/file-manager/src/zip-composition.ts` resolves a selection to archive entries, and line 105
runs every path through `disambiguate(path, taken)`.

`disambiguate` (`packages/file-manager/src/bundle-paths.ts:5`) suffixes `" (n)"` **before** the
extension and reserves the result in a `Set`, incrementing until free. Entries are sorted by path
first (line 103), so the outcome is deterministic for a given set. `report.pdf` twice becomes
`report.pdf` and `report (1).pdf`.

This holds on every delivery path:

- **Inline lane** — `apps/worker/src/routes/downloads.ts:487` calls `makeZip(zipEntriesFromR2(...))`
  over `resolved.entries`, which are already disambiguated.
- **Plain async lane** — line 456, same entries.
- **Optioned lanes** — `applyBundleLayout` (`bundle-layout.ts:10`) runs
  `sanitizeArchivePath` **first** (line 22) and `disambiguate` **second** (line 25). That ordering is
  the correct one: sanitizing after disambiguating could re-collide two paths that sanitize to the
  same string.
- **Single-file lane** — a 302 to a presigned GET (line 445); one file, nothing to collide with.

And the dedup is genuinely necessary, because `client-zip` does not do it. Its name handling
(minified function `d` in `client-zip@2.5.0`) only rejects an all-slash name and strips trailing
slashes — no uniqueness check, no `..` normalization. If `disambiguate` were removed, two identically
named entries would both be written into the archive and most extractors would silently keep the
second. **The guard is load-bearing and it is present.**

### What a de-duplicating rename at creation time would look like

Given the existing constraints, the shape is already established by the folder path:

- **The evidence pattern is `assertNameAvailable`** (`folder-service.ts:54`) — a read before composing
  the effect batch, raising a typed validation code. A file equivalent would add `file-name-taken` to
  `FileManagerValidationCode` and query `WHERE matter_id = ? AND folder_id IS NULL/= ? AND name = ? AND deleted_at IS NULL`.
- **The rename algorithm already exists** as `disambiguate` in `bundle-paths.ts`. It is pure, tested,
  and puts the suffix before the extension. Reusing it means one spelling of `" (n)"` across the
  archive and the file list, which is what a user seeing `report (1).pdf` in a download and then in
  the file list should get.
- **The hard part is the constraint, not the rename.** A `UNIQUE(matter_id, folder_id, name)` index on
  `file` would need `deleted_at` in it or a partial index, since a soft-deleted file keeps its row and
  its name. And it would hit the same NULL-distinctness hole the folder table already has: files at
  the matter root have `folder_id IS NULL`, so the index would not cover exactly the case the folder
  service had to work around in application code.
- **Auto-rename versus refuse is a product decision, not a technical one.** Folders refuse
  (`folder-name-taken`). If files auto-rename instead, the two behave differently in the same tree.
  Worth settling deliberately.

### Verdict on the owner's concern

**The concern is well-founded as an instinct and does not describe a live defect.** Two identically
named files cannot lose one another in a download today. What is real:

1. There is no uniqueness on file names at any layer, and there are producers that create duplicates
   without asking.
2. Duplicates are visually indistinguishable in the file list — same name, same icon, and the list is
   sorted newest-first (`documentsNewestFirst`, `document-presentation.ts:137`), so the two are not
   even adjacent.
3. The folder root has a real (if narrow) concurrency hole where two same-named folders can both land.

---

## Things the questions did not anticipate

**A quarantined version discards the evidence for its own quarantine.** Covered in question 4, but
worth restating on its own: `sniffed_content_type` is NULL on every quarantined row, so no later
review — human or automated — can reconstruct what the bytes actually were. The code comment at
`file-service.ts:872` argues that `scan_detail` exists precisely so a reviewer months later can tell
a malware hit from a size lie; it currently succeeds at that and fails at anything finer.

**The plain download lanes do not sanitize archive paths.** `applyBundleLayout` runs
`sanitizeArchivePath` and is applied only on the optioned lanes (`downloads.ts:316`, `:372`). The
plain inline and plain async lanes (`:456`, `:487`) use `resolved.entries` straight from
`resolveZipSelection`, which disambiguates but never sanitizes. Since a file name is validated as
`z.string().min(1)` with no character rules, a name containing `/` becomes a directory separator in
the archive, and `..` is not stripped by `client-zip` either. **This is not a duplicate-name problem
and it is not a data-loss problem — `disambiguate` still guarantees distinct entry names — but it
should be checked as a zip-slip question on its own.** I did not exercise it; the reading is from
source only.

**`problemGuidance` is already forked.** Two functions of that name with different bodies
(`document-presentation.ts:83`, `whois-lookup.ts:87`). A third surface should lift it, not copy it.

**The File Type Verifier is the product answer to question 4 and it has no page.** Route built,
report builder sound, `stage: "soon"`, engine undeployed. The prior audit
(`docs/research/2026-08-15-tools-reality-check.md`, section 14) already recorded the 503 and confirmed
`buildFileTypeReport` is correct. If the file manager wants a per-file "verify this" action, the
backend contract is finished and waiting.

**The Files matter section is declared `alpha`, not `ready`** (`sections.ts:33`). Whatever the file
manager ships, the tab keeps its Alpha badge until someone flips it — and per the maturity model, no
badge is what "ready" looks like.

## Method and limits

Source reading only, against `origin/main` at `4adf7d54`. Nothing was executed: no worker was run, no
test suite invoked (other agents share this machine), no container exercised. Claims about runtime
behaviour — the scan engine's 503, the LibreOffice edge parking — are read from code paths and from
the prior tools audit, not observed here. The zip-slip observation above is explicitly unverified.
