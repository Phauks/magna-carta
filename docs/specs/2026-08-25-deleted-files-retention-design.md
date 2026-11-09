# Deleted files — retention and presentation design

**Status:** Proposed (design) · **Date:** 2026-08-25 · **Owner:** Trevor Goldsmith
**White paper:** _Documents & automation_ (the deleted-file lifecycle: trash → Infrequent Access → policy-driven destruction) and _Matters and File Manager_, with _Discovery_, _Custodian_ and _Authentication & encryption_ (crypto-shred) as binding context.
**Decisions this builds on:** ADR-0049 (deleted-file lifecycle, Accepted), ADR-0077 (versions immutable, soft-delete only), ADR-0080 (closed is archived-but-additive), ADR-0035/ADR-0078 (tiering and metering).
**Rulings that bind:** [`docs/conventions/file-manager-rulings.md`](../conventions/file-manager-rulings.md) — A12 (delete works, soft-delete, folder dialog), D1b/D1c (the Deleted Files view is the matter's own table), D2 (restore asks at restore time, nearest surviving ancestor default), the round-seven owner rulings ("nothing is ever blocked"; "litigation holds are out of scope here — the hold table covers custody packets, not matter files, and our delete is a soft delete that destroys nothing"), L14b (the deleter is a person's name, never "You"), N22 (History records deletions forever).

**Not in scope:** the destruction policy engine itself (the retention-schedule vocabulary, per-jurisdiction encoding, client-notice workflow — its own later design; this document decides only that it is separate and what seam it plugs into); the erasure orchestrator (deferred; deleted file content joins the PII registry's report-manual class and nothing more); matter-file legal holds (ruled out of scope in round seven; the seam is named in section 6); the client portal's view of deletion (no portal yet).

---

## 1. Current state — what is built, what is ruled, what is decided

**Built.** `file.deleted_at` is the soft-delete flag (`packages/database/src/per-firm-schema.ts`); every default read filters `deleted_at IS NULL` alongside the clean-status gate, enforced by the source-scan fitness function. `DELETE /api/v1/files/{id}` soft-deletes: it reaps any live editing session, stamps `deleted_at`, destroys the transient `current` working copy (the one thing deletion destroys — a scratch object, re-materializable from the committed version), and writes a `file.deleted` audit row. `restoreFile` exists in `packages/file-manager/src/file-service.ts` — clears the flag, writes `file.restored` — **but no route calls it**, no query lists deleted files, and the schema records neither who deleted nor where from. The web app's file surface offers delete with the confirm line "It moves out of the list and stays recoverable."

**Ruled.** The Deleted Files view is designed and settled in the mockup rounds: the matter's own table plus Deleted, Deleted By and Was In columns (D1b), no explanatory paragraphs and Restore in the right-click menu (D1c), restore of an orphan asks once with the nearest surviving ancestor as the default destination (D2), and a deletion is a History row forever (N22). A12's dialog promises the file "stays recoverable" — a promise this design must keep true, not merely usually true.

**Decided.** ADR-0049 (Accepted) already settled the storage lifecycle: deletion is a soft-delete; the bytes move through a **trash window** (Standard storage, default 30 days, sized to Infrequent Access's 30-day minimum-storage charge so delete-then-undo churn pays no penalty), then **cold retention** (Standard → IA in place, the same server-side copy as superseded-version tiering), then — only under an explicit per-matter/jurisdiction policy — **destruction**, blocked by holds and audited. **Default retention is indefinite**; the destroy machinery ships with the switch off. The feature ledger carries this as `documents.versioning.deleted-lifecycle`: the `.trash` node is built, `.cold-retention` and `.destruction` are not.

So the questions this design answers are not "what is the lifecycle" — that is decided — but the layer above it: what the lifecycle means for the record and for every subsystem that touches a file, what the Deleted Files view owes the user about it, and which parts of ADR-0049's destruction stage need re-grounding against rulings issued since it was accepted.

---

## 2. Retention — how long, and who may purge

### Recommendation: recoverable indefinitely by default; the 30-day window is a storage boundary, never a recoverability boundary

The single most important clarification this design makes: **ADR-0049's trash window is a cost mechanism, not a countdown the user experiences.** At day 30 nothing becomes unrecoverable — the object gets ~33% cheaper to keep and stays restorable by exactly the same gesture (restore is a flag clear; the storage class flips back on the same server-side copy path, or the version simply serves from IA). A deleted file is recoverable on day 3,000 exactly as on day 3. That is what lets A12's dialog say "stays recoverable" without qualification, and it is the platform's own precedent applied: the notifications subsystem defends its 90-day sweep on the grounds that a notification is a **pointer** whose record lives elsewhere, and the custody register **refuses a retention window outright** because a custody entry is the record of a client's irreplaceable property. A deleted matter file is on the custody side of that line. It is the record — often evidence, sometimes client property under the entire-file doctrine — and the platform's whole posture (append-only ledger and audit, versions immutable, notes retracted never deleted, conflict copies retained forever) says records do not age out.

The legal grounding, reasoned from principle with the jurisdictional homework flagged rather than invented: under ABA Formal Opinion 471 the majority "entire file" approach makes most of the matter file the client's property, which a firm must be able to surrender at termination — a file a member deleted last year may be part of what must be handed over. Retention minimums vary by jurisdiction (six years is a commonly cited floor; some circumstances extend it indefinitely), and destroying matter content inside a minimum is malpractice and spoliation exposure with no offsetting benefit at R2 prices. **Real jurisdictional research is required before the destruction stage ships** — which jurisdictions' file-retention rules the schedule vocabulary must express, what client notice they require before destruction, and how "the file" is bounded in each — and per the trust subsystem's own invariant ("a jurisdiction fact refuses rather than falling back"), an unencoded jurisdiction must mean **no destruction**, never a default schedule.

### Who may purge — and does purge exist?

Purge exists, because ADR-0049 is right that it must: bar retention schedules end, clients instruct destruction, and privacy-law erasure can compel it — a platform that _cannot_ destroy fails the firm exactly when the firm is legally required to. But this design narrows **where** it exists:

- **Purge is a records-management policy operation, never a file-manager gesture.** There is no "Delete permanently" in the Deleted Files view — not per row, not on multi-select, not for admins. Destruction happens only through a firm-configured retention schedule (per matter or jurisdiction, the ADR-0049 switch), executed by a sweep, after the schedule's client-notice step, audited like any irreversible act. The first firm to hold an ad-hoc purge button will use it to remove something inconvenient, and the record will not say why — the same reasoning that denied notes a hard-delete permission.
- **Consequence for the view's honesty:** because no in-view gesture can destroy, the A12 promise is structurally true in the default deployment, and becomes conditional only when a firm deliberately configures a destruction schedule — at which point the UI changes with it (section 4).
- **Crypto-shred stays the separate whole-firm path** and is unaffected; the individual-erasure case (a court order against specific content) routes through the deferred erasure orchestrator's report-manual lane, a person deciding — never this subsystem improvising a byte-deletion path.

**Trade-offs owned:** indefinite default retention grows the discovery surface and, at platform scale, the storage bill — ADR-0049 already priced this (IA at ~$0.12/GB-year makes it cheap per firm; the destruction lever exists for when an obligation, not a cost, requires it). The rejected alternative — a firm-configurable recoverability window with a generous default, on the notifications pattern — was rejected because it borrows a policy from a subsystem whose defense ("it's only a pointer") does not transfer: here the swept thing would be the record itself, and a window would make the A12 dialog's promise false for every firm that shortened it. The tiered alternative (recoverable-in-view for N days, then admin-only restore) adds a second privilege boundary with no matching duty: nothing about day 31 changes who should be able to undo a mistake, and NetDocuments' deleter-only trash is a live example of restore-privilege partitioning making recovery worse.

---

## 3. What deletion means across the system

Deletion is one flag with system-wide consequences; each is stated so none is improvised at build time.

- **Versions:** untouched, by invariant (ADR-0077 — "files soft-delete, versions are untouched"). A restored file returns with its complete version history, hashes and all. Nothing here changes.
- **Hashes and integrity records:** retained and live. The ingest digest remains the tamper check (I47), and the Hashes tab works on a deleted file's versions exactly as on a live file's — a deleted file is the file most likely to need its chain of custody proven.
- **Safety history:** append-only and retained (F13); a re-scan can still be requested from the Deleted Files view's right-click, because a flagged deleted file is still a fact about the matter.
- **Search index — the one live gap:** nothing today tells the index about a deletion; `softDeleteFile` emits no outbox message and no consumer marks the file's index members stale, so a deleted file's passages remain live in the matter corpus (whether the result read then hides the row is a build-time verification; the index bytes hold the passages either way). **Recommendation: a deleted file leaves matter search; the Deleted Files view gets its own scoped search over the deleted set.** Mechanically: `softDeleteFile` gains a `file.deleted` outbox message; a consumer applies the existing stale-member mechanism (the same `markMembersStaleForDocument` path a re-index uses, feeding the per-split exclusion lists and repacked out at the next merge). Restore emits `file.restored` and re-enqueues indexing. The deleted view's own search starts as the table's existing name/metadata filtering (L36 machinery, already settled); content search within the deleted set is a named seam on the same exclusion machinery (a query that _inverts_ the exclusion), deliberately not built until asked for.
- **History:** `file.deleted` and `file.restored` are History rows forever (N22), each leading to the document where it now is (N22c). The audit rows already exist.
- **Storage class:** ADR-0049's cold-retention stage, built as a second candidate scan on the existing daily tiering sweep (`apps/api-worker/src/background/editing/tiering-sweep.ts`): versions of files with `deleted_at` older than the 30-day window whose class is still `standard` tier to IA through the same guarded flip + meter shift. The sweep's current scan (superseded versions) never touches a current version; the deleted-file scan deliberately does — a deleted file's current version is, by definition, no longer read. Restore does not eagerly re-tier; the version serves from IA (retrieval fee noted, ~$0.01/GB) and re-warms only if edited, keeping restore instant and free of a 30-day-minimum re-charge trap.
- **The working copy:** destroyed at delete, today's behavior, kept — it is transient scratch state, re-materialized lazily on the next edit launch. The dialog's promise concerns the record, and the record is the committed versions.
- **Writes:** a soft-deleted file takes no writes (`requireLiveFile` refuses; routes answer 404 so a write never reveals a deleted file) — unchanged, with restore remaining the one deliberate exception.

---

## 4. What the user is shown — the retention-aware Deleted Files view

The view itself is settled (D1b/D1c/D2); this section adds only what retention awareness requires, framed as rounds for the mockup.

**Round: the permanence statement, present only when it is needed.** By default there is **no countdown, no "days remaining" column, no expiry badge** — there is nothing to count down to, and rendering a 30-day storage transition as user-facing urgency would manufacture the very fear A12's wording exists to prevent. The L44 principle governs: absence is the signal. When — and only when — the matter falls under a firm-configured destruction schedule, the view grows a **Scheduled Destruction** column (a date, viewer-local per I44) and the delete dialog's wording changes to state the real window. **Dialog and view render from one source** (the I34 pattern: one text, two surfaces, structurally unable to disagree): a single resolved retention statement per matter — "stays recoverable" or "recoverable until {date} under {schedule name}" — feeds both.

**Round: the columns.** Deleted, Deleted By, Was In (D1b, settled) — with Deleted By a person's name backed by a real recorded fact (L14b; today the schema cannot answer it — section 7). Was In renders the recorded as-of-deletion path, which is also what D2's nearest-surviving-ancestor default resolves against. Storage class is deliberately **not** a column: Standard-vs-IA is cost plumbing, not a fact a member acts on.

**Round: restore, single and bulk.** Restore lives in the right-click (D1c), speaks for the whole selection with a count (A20), intact files go straight home silently, and a multi-restore with orphans asks once for one destination (D2, all settled). Restore requires no acknowledgement dialog of its own — undoing a delete is the safe direction.

**Round: empty and filtered states.** The empty view is one line — "No deleted files." — with no explanatory prose (D1c struck it once already). A filtered-empty deleted list says why with the clear affordance in place (L42).

**Firm-level (cross-matter) deleted view for admins: recommended no, recorded as an owner decision.** The oversight question an administrator actually has — "what has been deleted across the firm, by whom?" — is an audit/History question, already answered by the per-matter History and audit rows, and a cross-matter trash browser would be a second surface over the same facts (the P15 quarantine-view reasoning). The place a firm-wide surface genuinely will be needed is the destruction-policy administration screen (which matters are on which schedule, what is approaching destruction, the client-notice queue) — and that belongs to the destruction design, where the need is real, not to the file manager.

---

## 5. Interplay

- **Matter close/archive:** nothing happens to deleted files. Closed is archived-but-additive (ADR-0080); the Deleted Files view remains reachable and restore keeps working on a closed matter — a closed matter is exactly when a file-surrender request arrives. No close precondition and no close advisory: a deleted file is not an irregularity to warn about.
- **Holds — the seam, named honestly.** ADR-0049 says destruction is "blocked by any legal/discovery/Custodian hold," but the round-seven ruling stands: today's `custody_hold` covers custody packets, and matter files have no hold surface — which is acceptable **only because** default retention is indefinite, so there is nothing for a missing blocker to fail to block. The seam: the destruction sweep, when built, consults a **named blocker registry** (the close-precondition registry's pattern — an empty registry the owning subsystems register into), so a custodian hold, a discovery hold, or a future matter-file hold system each become one registration rather than a rewrite. **Destruction must not ship before at least the registry exists and refuses on any registered blocker** — shipping the lever before the guard would invert ADR-0049's own ordering.
- **Export ("Download Full Matter"):** deleted files do **not** ride along by default — the bundle resolver already selects clean current versions of non-deleted files, and a routine export should reflect the matter as the firm presents it. **Recommendation: an explicit "Include deleted files" option at bundle time**, for the entire-file surrender case where what was deleted is still the client's property: included files land under a `Deleted Files/` root in the archive, each at its as-of-deletion path, with the bundle manifest recording deleted-when and deleted-by so the export testifies to what it contains. The option composes with the existing bundle machinery (it widens the selection resolver's predicate and extends the manifest hash inputs, so the content-addressed artifact cache stays correct). Trade-off: an opt-in means a firm can under-produce by forgetting it; the mitigation is the option sitting in the bundle dialog where the choice is made, not buried in settings.

---

## 6. What the reference products do — verified, principles extracted

- **iManage Work:** deleted items stay in Trash **indefinitely** until restored or permanently deleted; an automatic age-out exists only when an administrator configures it, and administrators can restore or permanently delete from Control Center regardless of whether user-facing Trash is enabled (docs.imanage.com, Trash / Trash FAQ, verified 2026-08-25). Principle taken: the DMS-class default is keep-forever with destruction as a deliberate admin act — the ADR-0049 posture, independently arrived at.
- **Clio Manage:** deleted documents are recoverable from a trashed filter for **30 days** (help.clio.com, "Delete and Restore Documents," verified via search excerpt; the article body is login-gated). Principle taken as a warning: a fixed short window is a consumer-software convention transplanted into legal software, and it is precisely the promise this platform's own delete dialog refuses to make.
- **NetDocuments:** a deleted document is marked deleted rather than removed, but becomes visible and restorable **only to the person who deleted it** (support.netdocuments.com via third-party summaries; the vendor KB pages failed to load — noted rather than asserted as verified). Principle taken, by counterexample: recoverability partitioned by who deleted is a trap — the matter team, not the deleter, owns the record. This design's deleted view is matter-scoped and permission-scoped, never actor-scoped.
- **Legal-records retention guidance:** ABA Formal Opinion 471 — majority "entire file" approach to what must be surrendered; jurisdiction-varying retention minimums (six years commonly cited, sometimes extended indefinitely); destruction requires client notice and opportunity to retrieve (sdcba.org Ethics in Brief, alabar.org Formal Op. 2010-02, nhbar.org Op. 2015-16/05, lalegalethics.org — secondary sources; the jurisdictional specifics are exactly what section 2 flags for real research). Principle taken: the retention floor is a legal-duty question the firm answers per jurisdiction; the platform's job is to make keeping cheap and destroying deliberate.

---

## 7. Schema and API deltas implied

**Schema (per-firm lineage, additive):**

- `file.deleted_by` — `text`, `UserId`, deliberately **not** an FK (the deletion fact outlives the member row — the `uploaded_by` precedent). Backfills null for the handful of pre-existing deletions; the view renders an honest blank.
- `file.deleted_from_path` — `text`, the folder breadcrumb recorded at delete time. Recorded rather than derived because A12's folder-deletion cascade means the folder tree the file sat in can be gone by restore time; this column is what Was In renders and what D2's nearest-surviving-ancestor resolution walks. `folder_id` stays as the live pointer for intact restores. (Folder deletion's own record-keeping — whether cascaded folders soft-delete or their shape is recorded another way — surfaces here as an implied dependency and is called out in the owner list.)
- A partial index on `(matter_id, deleted_at)` `WHERE deleted_at IS NOT NULL` — the deleted list's read, kept off the live list's index.
- No new firm setting now: default retention is indefinite and needs no number. The destruction schedule's storage is the destruction design's to define.

**API (all through the chokepoint, OpenAPI re-emitted):**

- `GET /api/v1/files?deleted=true` (or a sibling list operation — builder's choice, one list contract either way): the deleted set for a matter, keyset-paginated, rows carrying `deletedAt`, `deletedBy`, `deletedFromPath` plus the standard row fields. Read posture matches the live list (matter-scoped, no separate capability).
- `POST /api/v1/files/{id}/restore` — body optionally `{destinationFolderId}` (D2: required only when the original location is gone; the route refuses a destination inside nowhere-land the same way the A16 picker excludes the deleted subtree). Permission: `files:delete` — deleting and undeleting are the same custody bracket, and a separate `files:restore` key would be a permission nobody would set differently (recorded as an owner decision). `audited: true`, `idempotency: "required"`.
- `DELETE /api/v1/files/{id}` unchanged in shape; its OpenAPI description's "retained for the recovery window" wording is corrected to the truth this design fixes: retained indefinitely by default.
- The bundle route gains the `includeDeleted` option (section 5).

**Machinery:**

- `softDeleteFile` / `restoreFile` gain `file.deleted` / `file.restored` outbox messages; a consumer marks index members stale on delete and re-enqueues indexing on restore (section 3).
- The daily tiering sweep gains the deleted-file candidate scan (deleted past the 30-day window, class still `standard`), reusing the guarded-flip + meter-shift + `file.tier_changed` pattern verbatim.
- The rulings harness gains checks for the new view facts (permanence statement single-sourced; no countdown by default; no permanent-delete affordance anywhere in the view).

---

## 8. Owner decisions

1. **Ratify the headline stance:** deleted files are recoverable indefinitely by default; the 30-day trash window is invisible cost machinery; no recoverability window exists for any firm to configure. (Section 2 — this is ADR-0049's default made load-bearing and user-visible; a fragment ADR records the ratification.)
2. **Ratify: no permanent-delete gesture in the file manager, ever** — destruction only through the future policy engine, which is its own design with the blocker registry as a shipping precondition. (Sections 2 and 5.)
3. **Search:** confirm "leaves matter search, searchable within the Deleted Files view" — and whether deleted-set **content** search is wanted at first build or stays a named seam. (Section 3.)
4. **Export:** confirm the opt-in "Include deleted files" bundle option and its `Deleted Files/` archive shape. (Section 5.)
5. **Firm-level cross-matter deleted view:** recommended against for now (oversight lives in History/audit; the real admin surface belongs to the destruction design). Confirm or overrule. (Section 4.)
6. **Restore permission:** rides `files:delete` (recommended) or becomes its own `files:restore` key. (Section 7.)
7. **Folder deletion's record:** the `deleted_from_path` column covers the file's side; decide whether cascaded folder deletion should also leave restorable folder rows (folders gain their own soft-delete) or the recorded path is the whole answer — this shapes how faithfully a deep cascade restores. (Section 7.)
8. **Jurisdictional research commission:** before any destruction work, the per-jurisdiction file-retention and client-notice rules the schedule vocabulary must express — real research, on the trust-jurisdiction precedent that an unencoded jurisdiction refuses rather than defaults. (Section 2.)
