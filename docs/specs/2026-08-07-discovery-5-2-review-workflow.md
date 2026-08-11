# Discovery — review workflow — design (slice 5·2)

**Date:** 2026-08-07
**Status:** Design proposed; owner decisions in section 12 are open. No product code in this cycle.
**Scope:** The review workflow over the corpus 5·1 builds: **tagging and coding** (the model, the
panel, family and duplicate semantics, bulk operations and their undo, and the audit trail a
meet-and-confer can stand on), **privilege review** (designation, the claim record, the privilege
log as a legal deliverable, and clawback), **redaction in review**, **productions out** (frozen
selections, Bates numbering, rendering formats, the production manifest, and withheld documents
appearing on the log and not in the volume), review **assignment and quality control**, and the
composition of all of it with ethical walls and the AI Search boundary.
**Area:** widens `packages/discovery` and its migration set; new routes in
`apps/worker/src/routes/`; a render job lane beside the processing lane; the first discovery UI in
`apps/web`; a small widening of `@magna-carta/sequence-numbering`; consumes `crates/pdf-core`
redaction and Bates engines as shipped.
**Not in scope:** technology-assisted review and analytics (deferred by decision), inbound load-file
parsing (5·1 open question, unchanged), direct collection, desktop-local review. Section 13 carries
the seams.

---

## Why now, and on what

5·1 built the corpus so that every review feature could be a function over it. The functions are
this slice. The owner's sequencing answer is **tagging first**: the slice plan (section 13) puts the
coding model and its surface in sub-slice 5·2·1, because every later capability — the privilege log,
production membership, QC sampling — is downstream of a coding decision, and none of them can be
exercised until a reviewer can make one.

What this design stands on, and what of it is still in flight:

| Substrate                                                                                                              | State                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The review-set model — sets, loads, review documents as version-pinned pointers, record custodians, family identifiers | **Shipped** (`packages/discovery`, migration `20260806T080000_discovery-5-1-2`)                                                                                                           |
| The Rust discovery core and its Container — identification, native extraction, normalization, fingerprints             | **Shipped** (`crates/discovery-core`, `containers/discovery` + `apps/discovery-worker`)                                                                                                   |
| Processing — the queue lane, the composite extraction port, dedup grouping and occurrence rows, exceptions, manifests  | **Not yet built** (5·1·3). Tagging does not depend on it; productions do (page counts, extracted text, dedup groups).                                                                     |
| Corpus indexing and the review-document list read                                                                      | **Not yet built** (5·1·4). The review surface pages through that read; 5·2·1 sits directly on it.                                                                                         |
| PDF redaction (rasterize-and-reassemble, verification gate fails closed) and Bates stamping (overlay, set-continuous)  | **Shipped** (`crates/pdf-core`; ADR-0134, ADR-0142)                                                                                                                                       |
| Sequential numbering — counter row, guarded increment, allocation-row conflict, bounded retry                          | **Shipped** (`@magna-carta/sequence-numbering`); increments by exactly one, so Bates block draws need a small widening (section 5.4)                                                      |
| The owner docket                                                                                                       | D1: the UI label is **"Custodian of Record"** (code and schema stay `record_custodian`, two words, linted). D5–D10 ratified as recommended. F4b binds every corpus-widening surface here. |

The dependency statement, honestly: **5·2·1 can begin the moment the 5·1·4 list read exists**, and
its model work can begin before that. 5·2·4 (productions) requires 5·1·3 complete — Bates needs the
page counts, text productions need the extracted text, and duplicate resolution needs the occurrence
rows.

---

## 1. What this design is, in one paragraph

A reviewer pages through a review set and **codes** documents against the review set's coding
panel — ordered **tag groups** (Responsiveness, Privilege, Confidentiality, issue codes, and
whatever the matter needs), each single-choice or multi-choice, whose tags optionally carry a
**semantic** the machine reads so that renaming a label never changes behavior. Every application
and removal is an **event** with an actor, an instant, and a scope, and the per-document state rows
are never deleted — removed is a state, so "who tagged what when" is one indexed read years later. A
privilege designation is a tag like any other, but it opens a **privilege claim**: the bases and the
log description that turn a coding decision into a privilege-log entry whose author, recipients, and
date are derived from the metadata 5·1 already extracted. A **production** is a frozen, explicit
membership — resolved once, staged, Bates-numbered from a per-matter register, rendered off the
request path with redactions burned by the shipped rasterize route, hashed, manifested, and then
**immutable forever**: a produced-then-clawed-back document is a new recorded fact about the
production, never an edit of it. Withheld-privileged documents appear on the log and never in the
volume. Every surface re-authorizes at read time, walled review sets are absent rather than hidden,
and nothing in this slice writes anything the AI Search feed can reach.

---

## 2. Tagging and coding

### 2.1 The model: groups and tags, not a tree and not a flat bag

Three candidate shapes, and the trade:

- **Flat tags** (one namespace per review set) are trivial to build and cannot express the thing
  review coding is actually made of: a _mutually exclusive choice_. "Responsive" and
  "Non-responsive" as independent flags means both can be on, and a corpus where 4% of documents
  are both is a corpus that cannot be produced from without a cleanup pass.
- **Arbitrary hierarchy** (nested issue trees) is what the heaviest review platforms ship and what
  small-firm reviews almost never use; it buys depth at the cost of every read, every panel, and
  every export carrying tree logic.
- **Two levels — groups containing tags — with cardinality on the group** expresses both real
  structures: a single-choice group is a radio row (Responsiveness), a multi-choice group is a flag
  set (issue codes). A flat bag is the degenerate case (one multi-choice group). This is the
  recommendation. Deeper nesting is refused by shape, not deferred by omission; if a matter ever
  needs an issue tree, that is a new design conversation, not a column.

**`review_tag_group`** — `id`, `review_set_id`, `name`, `kind` (`system` | `custom`), `cardinality`
(`single` | `multi`), `required_for_completion` (does QC count a document uncoded until this group
has a value), `sort_order`, timestamps. Unique on `(review_set_id, name)`.

**`review_tag`** — `id`, `review_tag_group_id`, `review_set_id` (redundant, for the review-set-wide
reads, same reasoning as the exception table), `name`, `semantic` (nullable, closed vocabulary
below), `color_token` (a design-token name, never a raw value), `sort_order`, `active`, timestamps.
Unique on `(review_tag_group_id, name)`. A tag that has ever been applied is **deactivated, never
deleted** — deleting one would orphan audit history, and audit history is the point.

**Semantics, not names, drive the machine.** The closed vocabulary:
`responsive`, `non-responsive`, `needs-further-review`, `privileged`, `privileged-redact`,
`not-privileged`, `confidential`. Privilege-log generation, production membership rules, redaction
QC, and completion arithmetic read **only** the semantic. A firm can rename "Privileged" to
"Withhold — AC privilege" and nothing breaks, because nothing ever matched the string. A custom tag
carries no semantic and drives no machinery — it filters, groups, and exports, which is what custom
tags are for.

**Three system groups are seeded** into every review set at creation: Responsiveness
(single-choice: responsive / non-responsive / needs further review), Privilege (single-choice:
privileged / privileged — redact / not privileged), Confidentiality (single-choice, seeded from the
common protective-order designations, freely editable). System groups are renamable and their tags
are renamable; the groups themselves and the semantic-bearing tags are not deletable, because
production logic stands on their existence.

### 2.2 Per-document rows, always — family and bulk are scopes, not storage

The tempting model — a "family tag" row that families inherit at read time — makes production
membership a join over inheritance rules executed years after the coding pass, which is exactly
where an inheritance bug becomes a produced privileged document. So: **the unit of tag storage is
one row per (document, tag) application**, whatever gesture applied it. Applying a tag "to the
family" writes a row per family member; a bulk application writes a row per selected document. The
**event** records the gesture (scope, criteria); the **rows** record the result. Production reads
rows and only rows.

**`review_document_tag`** — `id`, `review_set_id`, `review_document_id`, `review_tag_id`,
`review_tag_group_id` (denormalized from the tag), `single_choice` (denormalized from the group),
`applied_by_event_id`, `applied_at`, `removed_by_event_id` (nullable), `removed_at` (nullable).

- **Current state** is `removed_at IS NULL`. Rows are never deleted — removal is a state with an
  actor and an instant, which is what makes the coding history of one document one indexed read.
- **Single-choice is structural, not guarded**: a partial unique index on
  `(review_document_id, review_tag_group_id)` where `removed_at IS NULL AND single_choice = 1`.
  Changing a single-choice answer is remove-plus-apply in one effect batch; two concurrent writers
  cannot leave a document both responsive and non-responsive, because the index refuses the second
  row. The denormalized columns exist to make the database able to say so.
- The **family-conflict read** (a privileged document whose family parent is coded produce, and the
  reverse) is a computed read over these rows joined through `family_id` — surfaced as a review
  filter and enforced as a production staging check (section 5.3). It is never a stored flag,
  because a stored flag about two rows goes stale when either moves.

**Duplicates: the primary speaks for the group.** Dedup review (the point of D5) means the primary
is the document a reviewer sees and codes; occurrence rows keep the other custodians' copies honest.
Coding rows attach to the primary only. A surface showing an occurrence shows the primary's coding,
read through — never copied, so there is nothing to drift. Production resolves membership through
primaries and carries every occurrence's record custodian into the load file (section 5.6), which is
the whole-program lesson — "which custodians held this" — paying off at the exact moment an opposing
party asks it.

### 2.3 The audit: an event journal a meet-and-confer can stand on

**`review_tag_event`** — `id`, `review_set_id`, `kind` (`apply` | `remove` | `bulk-apply` |
`bulk-remove` | `undo`), `review_tag_id`, `scope` (`document` | `family` | `selection`),
`document_count`, `criteria` (bounded JSON text: the filter that drove a bulk selection, as typed),
`selection_r2_key` (nullable — the materialized selection for bulk, section 2.4), `state`
(`running` | `complete` | `undone`), `reverses_event_id` (nullable), `actor_user_id`, `created_at`,
`completed_at`.

One row per human act, however many documents it touched. The per-document consequences are the
`review_document_tag` rows pointing back at it. Together they answer, in indexed reads and without
reconstruction: _who coded this document, as what, when, one at a time or in bulk, under what
criteria, and who reversed it_. That is the record a court asks for when a production is challenged,
and it is also the record that makes the platform's own `domainAuditStatement` wrapper unnecessary
here — the journal **is** the audit, richer than the generic row would be, and writing both would be
two homes for one fact. Nothing in an event row is content: tag names live in the tag table,
criteria are field names and identifiers, and free text is refused in criteria by schema.

### 2.4 Bulk semantics: frozen selections, exact undo

- **The selection is materialized at initiation.** A bulk apply over "search results for X" resolves
  the criteria **once**, writes the resulting identifier list to R2
  (`discovery/<reviewSetId>/selections/<eventId>.json` — at the ceiling, a 250,000-identifier list
  is a few megabytes), and the operation walks that list. It never re-runs the criteria per chunk:
  the corpus moves under a long operation, and a selection that drifts mid-operation applies a tag
  to documents the operator never saw. The criteria are recorded for humans; the list is what
  executed.
- **Above a chunk threshold the walk runs through a coordinator** Durable Object with its cursor in
  durable storage — the `DiscoveryLoadCoordinator` pattern, reused not reinvented — reporting
  progress on the existing per-job channel. Below it, one effect batch.
- **Undo is compensation, not deletion, and it is exact.** Undoing a bulk apply writes an `undo`
  event that removes precisely the rows whose `applied_by_event_id` is the undone event **and**
  which are still live — a tag someone else applied independently afterwards has its own row and its
  own event and is untouched; a row already removed stays removed with its original removal
  attribution. Undoing a bulk remove re-applies by the same rule (rows removed by that event and not
  since re-applied). The undone event stays in the journal in state `undone`, pointing at its
  reversal. History never shortens.

### 2.5 The surface, minimally stated

The review surface is the 5·1·4 list read plus three things: the coding panel (the review set's
groups, rendered as radio rows and flag sets, keyboard-first because reviewers code thousands of
documents), tag chips and counts on the list (the list read gains a per-page tag join, measured, not
assumed), and a document viewer pane that serves content **through the existing file-manager and
email read paths** — the review surface renders pointers it re-authorizes, it does not acquire a
private content path. UI detail beyond this belongs to the build against the design system; the
spec's concern is that every element above is a read or write already specified here.

---

## 3. Privilege

### 3.1 A tag with semantics, plus a claim — deliberately both

The two pure shapes both fail:

- **Privilege as only a tag** makes designation uniform with the rest of coding (same panel, same
  bulk operations, same audit, same filters — all genuinely wanted) but a tag cannot carry what a
  privilege log entry needs: which privileges are claimed, and the described basis. Jamming those
  into per-tag metadata makes the one tag structurally unlike every other tag.
- **Privilege as its own model** gets the log right and forks the review workflow: two panels, two
  bulk paths, two audit trails, and every "what is coded on this document" read unioning two
  shapes.

The recommendation is the hybrid: **designation is the system Privilege tag** (single-choice,
semantics `privileged` / `privileged-redact` / `not-privileged`), so workflow, filtering, bulk, and
audit are the one mechanism of section 2 — and **a document designated privileged opens a
`privilege_claim`**, the record the log is generated from.

**`privilege_claim`** — `id`, `review_set_id`, `review_document_id` (unique — one claim per
document), `description` (the log narrative, bounded), `author_override`, `recipients_override`,
`claim_date_override` (all nullable), `created_by`, timestamps, maintained under the same event
discipline (claims are edited; edits are audited via the platform's `domainAuditStatement`, since
the claim is not a tag row).

**`privilege_claim_basis`** — junction to **`privilege_basis`**, a review-set-scoped list seeded
with the standard grounds (attorney-client communication, attorney work product, joint
defense / common interest, and the jurisdiction-common others), firm-extensible. Multiple bases per
claim, because real logs claim them jointly.

A claim without a live `privileged` or `privileged-redact` tag is **dangling** — surfaced as a QC
read, not silently deleted, because the claim text is work someone did and the designation may be
coming back.

### 3.2 The log: a deliverable generated from facts, never from content

A privilege log entry is: log number, document date, author, recipients, privilege(s) claimed,
description. The design's one hard rule: **every derived field comes from metadata 5·1 already
extracted** — for email, the participant set and sent time from `email_message`; for documents, the
sidecar metadata and `sort_date` — with the per-claim overrides for the routine case where metadata
is wrong or missing. The description is the only authored text, written by the reviewer in the
claim, with the UI stating plainly what a description must never do (quote or paraphrase the
privileged content — the log describes the _ground_, not the _substance_). Nothing in the generator
reads extracted text, structurally: the generator's inputs are the claim, the tag rows, and the
metadata sidecar, and the text object's key never enters it.

The log exists in two modes:

- **Draft, on demand, at any time** — a paged read and an export, regenerable, watermarked as
  draft, covering whatever is currently designated. This is the working document counsel iterates
  on.
- **Frozen, per production, at cut** (section 5) — generated over exactly the documents withheld or
  redacted in that production, written to
  `discovery/<reviewSetId>/productions/<productionId>/privilege-log.*` beside the production
  manifest, immutable with it. The log served on opposing counsel is a record of the production, so
  it lives and freezes with the production.

Format: owner flag **P4**; recommended CSV plus a printable text rendering (the pattern the load
manifest set), with the machine-readable JSON alongside.

### 3.3 Clawback — both directions, neither edits history

- **Inbound** (the other side claws back from us): already modeled — the receiving load is
  `reversed`, a recorded act on a completed load. 5·2 adds the review-surface consequence: documents
  of a reversed load leave every list and every index, and any coding rows they carry are retained
  (removed-state, attributed to the reversal event) because "we reviewed it before the clawback" is
  itself a fact counsel may need to state.
- **Outbound** (we produced privileged material and claw it back): the production is immutable, so
  clawback is **a new recorded fact about a member**, never an edit. `production_member` gains
  `clawed_back_at`, `clawback_basis`, `clawback_reference` (the letter or order, as a document
  pointer), written by a recorded act requiring `discovery:produce`. The Bates numbers stay burned
  — they were served and are cited. The document is re-designated privileged in review (ordinary
  tag event), the claim opens, and the next log regeneration includes it flagged as clawed back. A
  supplemental or replacement production, where ordered, is a **new production** carrying a recorded
  relation (`replaces_production_id`), because a corrected volume is a new act of production.

---

## 4. Redaction in review

The engine shipped (rasterize-and-reassemble with a fail-closed verification gate); 5·2 gives it its
workflow. **`review_redaction`** — `id`, `review_set_id`, `review_document_id`, `page_index`,
`regions` (bounded JSON: rectangles in page coordinates), `label` (the burned text, e.g. "REDACTED —
privilege"), `created_by`, timestamps, soft-removal like tag rows. Drawn in the viewer over the
existing preview rendering; stored as data, **burned only at production render**. The review copy
stays internally unredacted — reviewers must see what they are redacting — and the walls of section
7 are what gate who reviews.

Two rules with teeth:

- A document with live redactions and semantic `privileged-redact` produces **as image only**; a
  native production of a redacted document is refused at staging by name, because native bytes do
  not carry burns.
- **Production text for a redacted document is derived from the redacted artifact or omitted —
  never the pre-redaction extraction.** Handing over the original extracted text beside a redacted
  image is a redaction failure by sidecar, and the render pipeline makes it unrepresentable: the
  text member of a redacted document's production artifact set is generated (via the recognition
  engine over the redacted image, per-production option) or absent. The pre-redaction text key never
  reaches the production writer.

---

## 5. Productions

### 5.1 A production is evidence of what was produced

**`discovery_production`** — `id`, `review_set_id`, `name`, `state` (`draft` | `staged` | `cut`),
`bates_prefix`, `bates_number_width`, `options` (bounded JSON: format rules, slipsheet choice, text
handling, sort order), `volume_label`, `served_on_description`, `replaces_production_id` (nullable),
`created_by`, `staged_at`, `cut_at`, `manifest_r2_key`, timestamps.

The lifecycle, and why it is shaped this way:

- **`draft`** — criteria and options are editable; membership is a preview read, not rows.
- **`staged`** — the act of staging **resolves the criteria once into explicit `production_member`
  rows** (a frozen selection, the same device as bulk tagging, for the same reason: a production
  whose membership is a stored query re-answers differently later, and "what did we produce" must
  never be a query), assigns Bates provisionally from a drawn block (5.4), and runs the QC gate
  (5.3). Staging is reversible: un-staging returns to `draft`, deletes the member rows, and
  **abandons the Bates block, recording the gap** in the register — a gap with a recorded reason is
  ordinary Bates hygiene; renumbering a later production into an abandoned range is how two
  documents end up sharing a number.
- **`cut`** — forward-only, enforced by trigger like every discovery state machine. Rendering runs
  (5.5), artifacts are hashed, the manifest and the frozen privilege log are written, and from that
  instant **nothing about the production changes, ever**: no member changes, no option changes, no
  re-render, no deletion. Production artifacts are **records, not caches** — they live under
  `discovery/<reviewSetId>/productions/<productionId>/`, deliberately outside
  `reviewSetDerivedPrefixes`, and closing the review set never collects them. Corrections are new
  productions with a recorded relation.

**`production_member`** — `id`, `production_id`, `review_set_id`, `review_document_id`,
`disposition` (`produce-image` | `produce-native` | `produce-text-only` | `withhold-privileged`),
`bates_start`, `bates_end` (both null for withheld — owner flag **P2**), `has_redactions`,
`family_id` (copied at staging for the family QC reads), `sort_position`, `render_state` (`pending`
| `rendered` | `excepted`), timestamps. Unique on `(production_id, review_document_id)`.

### 5.2 Membership: rules propose, rows decide

Membership is drawn at staging from coding semantics: documents coded `responsive` (or an explicit
criteria set — a second request produces by request number, not responsiveness alone), minus
duplicates (primaries only), with disposition derived per document: `withhold-privileged` for
semantic `privileged`; `produce-image` for `privileged-redact` and for the default document classes;
`produce-native` where the per-production format rules say so (the shipped convention:
spreadsheets and media native, documents and email as image — recorded in `options`, overridable
**per member before cut**, every override a recorded act). The rules are conveniences that write
rows; the rows are the production.

### 5.3 The staging QC gate — refusals, by name

Staging fails, naming every failure, when:

- **A family is split silently.** A family with members on both sides of the produce/withhold line
  requires a recorded per-family decision (owner flag **P3**: recommended default — produce the
  non-privileged members, withhold the privileged ones, log entries record the family
  relationship; whole-family withholding is the per-production alternative).
- A `privileged`-coded document has no claim, or a claim dangles without designation.
- A redacted document is dispositioned native (section 4).
- A member's review document is not `processed` (an excepted document can be deliberately
  dispositioned — produce native without text, or withhold-technical with a stated reason — but
  never silently included as if extraction had succeeded).
- Any member document is uncoded in a `required_for_completion` group.

The gate re-runs at cut, because member-level overrides happen between.

### 5.4 Bates numbering: compose with the sequence-numbering package, widened by one verb

Bates continuity is per matter and prefix — successive productions in one matter continue the range,
and two productions must never overlap. That is exactly the sequential-number draw the platform
extracted into `@magna-carta/sequence-numbering` for matters and billing, with one mismatch: the
shipped guarded increment advances by exactly one, and a production draws a **block** (the sum of
member page counts, in the thousands). The recommendation is to **widen the package with a block
draw** — a guarded increment by N (`next_value = next_value + ?N` guarded on the observed value)
whose allocation row records the drawn start and length, keeping the allocation-row primary key as
the real guard exactly as the package's own invariants demand — rather than building a second
counter mechanism in discovery (the drift the extraction existed to prevent) or looping the
single-value draw thousands of times against a real database.

The register scope key is `(matter_id, bates_prefix)`. Within the drawn block, assignment is
deterministic and unconcurrent: the staging coordinator walks the frozen member list in
`sort_position` order (the recorded sort: record custodian, then family, then date by default, an
`options` choice), assigning each produced member a contiguous page range from the running total. Withheld
members consume nothing (owner flag **P2**). The stamped overlay is the shipped `crates/pdf-core`
engine, fed ranges the database already committed — the stamp never invents a number.

### 5.5 Rendering: off the request path, terminal outcomes, reconciliation

A cut fans out per member through a **dedicated `DISCOVERY_PRODUCE` queue lane** (its own
dead-letter queue, the 5·1 topology precedent) — separate from `DISCOVERY_PROCESS` because a
court-deadlined production must not sit behind a quarter-million-document load, and a load must not
sit behind a production. Per member, by disposition:

- **Image**: render pages, burn live redactions via the rasterize route (verification gate fails
  closed — a gate failure is a member exception, never a silent pass-through), stamp the Bates
  overlay, write the artifact.
- **Native**: copy the as-received bytes (which 5·1 never modified — this is the moment that rule
  was for), stamp nothing, assign the document-level Bates label in the load file.
- **Text**: per section 4's invariant — redacted members get recognition-derived or no text;
  unredacted members get the extracted text object copied into the production tree (copied, because
  the production must remain intact if the review set closes and its derived cache is collected).

Every member ends `rendered` or `excepted` with a named code (the 5·1 exception discipline,
reused with production-stage codes), and the cut completes only when
`member_count = rendered + withheld + excepted-with-recorded-decision` — the reconciliation
invariant, third appearance, same reason: a production that silently dropped a document is a
defensibility failure that surfaces in front of a judge.

**The manifest**, written at completion beside the frozen privilege log: production identity,
options as run, the Bates range consumed, counts by disposition and outcome, one row per member with
its Bates range and the **five digests of every produced artifact** (`packages/file-integrity`, the
algorithms opposing counsel's tooling verifies with), engine versions, and the load files. Load-file
export ships Concordance DAT and Opticon OPT (text formats, pure TypeScript writers) with the
standard field set — begin/end Bates, begin/end attachment (family integrity, visible), the
"Custodian of Record" field, and the industry's all-custodians interop column carrying every occurrence's record
custodian, which is the dedup-keeps-the-duplicate lesson delivered to the party that asks. Delivery
of the volume itself reuses the existing bulk-download machinery; a server-assembled single archive
is a named seam.

### 5.6 What is _not_ in the volume

Withheld-privileged members produce no artifact and appear on the frozen log. Documents of a
reversed (clawed-back inbound) load cannot be staged at all. Occurrence duplicates are never
members. And no production artifact is a File Manager file — which, with the feed's own
construction, is what keeps productions out of AI Search (section 8).

---

## 6. Assignment, progress, and quality control

Deliberately thin in early sub-slices, because a solo-to-small firm reviews without formal batch
discipline and the coding model must not wait for one.

- **Slice 1 ships**: per-document completion (coded in every `required_for_completion` group),
  review-set progress counts (coded / uncoded / excepted, by group), and filters for "uncoded",
  "coded by me", "coding conflicts". That is enough for a small review to self-organize.
- **5·2·5 ships batches**: **`review_batch`** (a frozen identifier list — the materialized-selection
  device a third time — with a name, an assignee, and a state), single-assignee checkout, progress
  per batch, and **second-pass QC sampling**: a QC batch drawn as a seeded random sample at a
  recorded rate over first-pass-complete documents, re-coded blind, with a disagreement read
  (documents where second-pass coding differs) as the QC deliverable. Sampling parameters are
  recorded on the batch — a defensibility statement ("n% blind second pass, disagreement rate r")
  is a sentence counsel signs.

---

## 7. Ethical walls and permissions — verified composition

The wall posture this slice inherits and must not weaken:

- **Review-set access is not implied by matter access** — shipped in 5·1·2 as the permission
  namespace, proven by a route test. 5·2·1 builds the **per-review-set access list** that 5·1·2
  named and deliberately did not build ("a list nothing renders is a list nothing enforces" — the
  review surface is the thing that renders it): membership defaulting to the matter team at
  creation, narrowable to named members, checked by every discovery read and write beside the
  permission check. An attorneys'-eyes-only production is a review set whose list is two people,
  and that is the entire mechanism.
- **Read-time re-authorization everywhere.** The viewer serves bytes through the existing
  file-manager and email read paths, which re-authorize per request; search hits over the review-set
  corpus hydrate through the data-access layer exactly as `SearchHit` already specifies (pointers,
  never text, re-read after authorization); tag rows, claims, logs, and production artifacts are
  review-set-scoped reads behind the access list. No 5·2 surface caches content past a wall check,
  and no filter is load-bearing for isolation — the corpus index is already per-review-set by
  construction (D3), so even a mis-built query cannot name another corpus's splits.
- **Absence, not existence.** A walled review set never appears in any list, count, progress
  surface, or error; the ADR-0052 / ADR-0196 rule, applied to every read this slice adds. Privilege
  logs and production manifests — the most sensitive reads in the subsystem — are behind
  `discovery:produce` plus the access list.

New permission keys, beside the shipped `discovery:read` / `:manageReviewSets` / `:load`:
**`discovery:review`** (apply coding, claims, redactions; run bulk operations) and
**`discovery:produce`** (stage, cut, clawback, freeze and export the log, manage the access list).
Whether privilege _coding_ needs a tier of its own is owner flag **P1**; the recommendation is no —
the produce gate is where a designation becomes consequential to the outside world, and gating the
coding gesture itself would make privilege review a bottleneck in exactly the small firms this
platform serves.

---

## 8. The AI Search boundary, preserved by construction

The AI Search design's rule is absolute: review sets are never fed to the derived text feed, with no
flag, because there is no case where it should be on. 5·2 preserves it structurally, and the design
states the verification rather than the intention:

- The feed has exactly one producer — committed file-version text of working documents — and **5·2
  adds no producer**. Nothing in this slice writes a file version: tag rows, events, claims,
  redactions, and production rows are per-firm database rows; selections, logs, manifests, and
  production artifacts are R2 objects under the `discovery/` prefix, which no feed code reads.
- Received-production bytes are File Manager files (D7) and already carry the origin discriminator
  the feed excludes; 5·2 neither copies them nor re-files them.
- Production artifacts deliberately do **not** become File Manager files (section 5.1) — the one
  design choice in this slice that could have created a leak path, refused for this reason among
  others.
- A fitness assertion accompanies the build: no module under the feed producer imports from
  `packages/discovery`, and no discovery R2 prefix appears in feed code — cheap to assert, and the
  kind of boundary that should be a test rather than a memory.

---

## 9. The transcript control (F4b), restated for this slice

The owner's ruling binds every surface that could sweep transcripts into a corpus or a search scope:
inclusion is a person's visible choice, never a default. 5·1·2 shipped the load-side half — every
load declares `transcript_scope`, `include` refused by name until the lane exists. 5·2's
obligations: the review, coding, and production surfaces **never widen any scope** — they operate on
what loads brought in, and nothing here reaches into conversation records; and the transcript lane
itself lands in 5·2·6 (a `magnus_transcript` source kind on the review document, the export of a
transcript to a reviewable artifact, and the un-refusal of `transcript_scope: 'include'`), at which
point a transcript in a review set is an ordinary review document — taggable, privileged-by-default
as work product per the owner's framing (seeded coding, not hard-coded), producible only by the
same recorded decisions as anything else.

---

## 10. Scale honesty

The new arithmetic, against the 5·1 budget (a 250,000-document review set, per-firm D1 at 10 GB):

- **`review_document_tag`** is the growth table. A realistic heavy review — five tags per document
  average, 1.5 application episodes each (churn from re-coding and bulk undo) — is ~2,000,000 rows
  at roughly 130–150 bytes plus indexes: a few hundred megabytes, second only to `review_document`
  itself, inside budget but **measured, not assumed** — the load profile below carries it, and bulk
  churn is the lever to watch (a bulk apply-undo-apply cycle over the whole corpus writes 750,000
  rows; the coordinator threshold and the profile measurement decide whether that ever needs a
  compaction story, which is deliberately not designed today).
- **`review_tag_event`** is one row per human act — thousands, not millions. Criteria JSON is
  bounded small; selections go to R2.
- **`production_member`** at the ceiling is 250,000 narrow rows per production; a matter with
  several full-corpus productions multiplies it, which the profile measures. Render fan-out obeys
  the 5·1 queue arithmetic (it is the same shape of job at the same scale, on its own lane).
- **Renders are the expensive line**: rasterize-plus-stamp is seconds per hundred pages in the
  Container; a 100,000-page image production is hours of wall clock at full lane concurrency —
  fine as a queue job with progress, fatal anywhere else, and the reason `DISCOVERY_PRODUCE`
  exists apart from interactive traffic.
- **Load-profile obligations** (`packages/fixtures/src/load-profile/`, extending the 5·1 generator):
  coding-state distributions and tag churn as profile parameters; measurements with snapshotted
  baselines for the list-page read **with** its tag join, single-document coding write, bulk apply
  at 10,000 and at the ceiling (p50/p95), the family-conflict read, draft-log generation, staging
  (membership resolution + Bates walk) at the ceiling, and the per-firm database size delta after a
  heavy coding pass — the number the tag-table budget is re-derived from.

---

## 11. Defensibility, the additions

5·1's five properties carry; 5·2 adds four in the same voice:

1. **Every coding decision has an actor, an instant, and a gesture.** Rows are never deleted;
   removal is attributed; bulk operations record their frozen selection and their criteria.
2. **A production is immutable evidence.** Frozen membership, drawn Bates blocks that are never
   reused, hashed artifacts, a manifest and log written once. Corrections and clawbacks are new
   recorded facts.
3. **The log never touches content.** Generated from metadata and authored basis descriptions;
   structurally unable to read extracted text.
4. **Nothing produced was silently altered, and nothing withheld silently vanished.** Natives are
   as-received bytes; images are declared renders with recorded redactions; every member reconciles
   to rendered, withheld-on-log, or excepted-with-a-decision.

---

## 12. Owner decisions

Each carries a recommended default; approving the recommendations approves the design as written.

| #      | Decision                                                | Recommended default                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | Does privilege _coding_ require its own permission tier | **No** — `discovery:review` codes and writes claims; `discovery:produce` is the consequential gate (staging, cut, log freeze, clawback). A separate coding tier bottlenecks small-firm review for no defensibility gain         |
| **P2** | Withheld-privileged documents and Bates                 | **Withheld documents consume no Bates numbers and get no slipsheets by default**; a per-production slipsheet option exists for protocols that require placeholders. The log, not the volume, is where withheld documents appear |
| **P3** | Default when privilege splits a family                  | **Produce the non-privileged members, withhold the privileged ones, and record the family relationship on the log entries**; whole-family withholding is the per-production alternative, chosen at the staging decision         |
| **P4** | Privilege log delivery format                           | **CSV plus a printable text rendering** (the load-manifest pattern), machine-readable JSON alongside; spreadsheet-native export deferred until asked for                                                                        |

---

## 13. The slice plan — tagging first

**5·2·1 — Tagging and coding.** The owner's "first", and the foundation everything else reads.
Schema and services for `review_tag_group` / `review_tag` / `review_document_tag` /
`review_tag_event` with the structural single-choice index and the seeded system groups; the new
`discovery:review` and `discovery:produce` permission keys and the **per-review-set access list**
with its route enforcement; document and family application; bulk apply/remove over materialized
selections with the coordinator above the chunk threshold and exact undo; the coding panel, tag
chips on the list read, and the viewer pane over the existing content read paths; progress counts
and the uncoded/conflict filters; the load-profile coding parameters and the first four
measurements. _Depends on the 5·1·4 list read; the model and services can start before it._

**5·2·2 — Privilege review.** `privilege_basis` (seeded), `privilege_claim` and its bases junction;
claim editing under domain audit; the dangling-claim and family-conflict QC reads; derived log
fields with overrides; the **draft privilege log** as a paged read and an export in the P4 formats.

**5·2·3 — Redaction in review.** `review_redaction` rows, the viewer overlay tooling over the
existing preview rendering, soft removal, and the redacted-members filter. No burning — that is the
production renderer's, and shipping the drawing first means redaction work proceeds during review
rather than at the deadline.

**5·2·4 — Productions.** `discovery_production` / `production_member` with the draft ⇄ staged → cut
machine (triggers, as always); membership resolution and the staging QC gate; the sequence-numbering
**block draw widening** and the `(matter, prefix)` Bates register; the `DISCOVERY_PRODUCE` lane and
per-member rendering (image with burn and stamp, native as-received, the text invariant);
the production manifest with five-digest artifact hashes; DAT/OPT load files with the Custodian of
Record and all-custodians interop fields; the frozen privilege log at cut; outbound clawback
records;
delivery through existing bulk download. _Depends on 5·1·3 (page counts, extracted text, dedup
groups) and 5·2·2/5·2·3._

**5·2·5 — Batches, assignment, and QC sampling.** `review_batch` as frozen lists with assignees,
checkout, per-batch progress, the seeded random second-pass sample at a recorded rate, and the
disagreement read.

**5·2·6 — Review aids and the transcript lane.** Email threading surface over the shipped
`email_thread`; near-duplicate clusters over the 5·1 fingerprints (threshold recorded, clusters as
a review filter, never touching production logic); and the transcript lane — the
`magnus_transcript` source kind, transcript export to a reviewable artifact, and the un-refusal of
`transcript_scope: 'include'` under F4b's visible-choice rule.

Each sub-slice lands with its docs (developer and user — the user guide for coding and for reading
a production manifest matters as much as the exception-report guide did), its status and changelog
fragments, roadmap ledger updates, and decision fragments for anything the build settles.

---

## 14. Named seams and open questions

- **Firm-level coding templates** — a firm that runs the same panel every matter will want "new
  review set from template". Review-set-scoped groups are correct today (the 5·1 reasoning about
  cross-matter assertions applies to taxonomies too); a copy-on-create template library is additive
  later.
- **Server-assembled production volumes** — one archive per volume, assembled in a Container.
  Delivery today reuses client-side bulk download; the seam is named where volume size outgrows it.
- **Slipsheet rendering** — if P2's option is ever exercised, the generator is `pdf-core`'s
  from-scratch page generation, which ADR-0142 deferred; exercising the option un-defers it.
- **Search-driven bulk tagging at index scale** — bulk selections over keyword search results
  compose once 5·1·4's corpus index is live; the materialized-selection contract is written so the
  criteria source is opaque to the executor.
- **ESI-protocol presets** — production options as importable presets matching common protocol
  terms. Options-as-JSON is the substrate; presets are product work later.
- **Redaction reasons taxonomy** — labels are free text today; if logs ever need redaction-basis
  statistics, a basis reference beside the label is additive.
- **TAR / analytics** — deferred by decision, unchanged; the coding journal is deliberately shaped
  so a future ranker can train on it without a schema change (document, tag, actor, instant — that
  is a training row).
