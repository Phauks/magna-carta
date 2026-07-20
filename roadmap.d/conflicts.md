# Conflicts Check

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: conflicts
  name: Conflicts Check
  scope: Firm-wide conflict checking across the Directory graph and matter role-links, with configurable strictness/depth, human clearance, and an immutable log.
  status: partial
  slices: 4-1-conflicts
  adrs: ADR-0013
  spec: docs/specs/2026-07-09-slice-4-1-conflicts-design.md
  evidence: "@magna-carta/conflicts + apps/worker/src/routes/conflicts.ts on main: matching, clearance, and the append-only log are built; check triggers and the reviewer UI remain."
  notes: Reviewer adjudication UX and automated triggers (intake/party-add/periodic) are the remaining gaps.

- id: conflicts.directory-seams
  name: Directory matching seams
  scope: Name normalization, phonetic keys, entity search, and duplicate-detection/merge machinery in the Directory.
  status: shipped
  slices: 1-3-directory, 1-4-custom-fields-engine
  adrs: ADR-0085, ADR-0086
  evidence: packages/directory/src (normalize-name.ts, phonetics.ts, search.ts, merge.ts) on main.

- id: conflicts.triggers
  name: Check triggers
  scope: Run checks at intake, whenever a party is added, and on optional periodic re-scans.
  status: not-started
  evidence: The worker route (apps/worker/src/routes/conflicts.ts) is the only caller of runConflictsCheck — a check runs on request, not on an intake/party-add/periodic trigger.

- id: conflicts.matching-engine
  name: Matching engine
  scope: Candidate generation and scoring over names/identifiers (exact, fuzzy, phonetic, alias/blind-index) with related-party edge expansion.
  status: shipped
  slices: 4-1-conflicts
  adrs: ADR-0013
  spec: docs/specs/2026-07-09-slice-4-1-conflicts-design.md
  evidence: packages/conflicts/src (matching.ts, expansion.ts, evidence.ts) — no-scorer, evidence-tiered (identifier > exact name > phonetic > trigram) with graph-path expansion.
  notes: Reviewer UI deferred (backend + API shipped). A match landing on the check's own subject party surfaces flagged co_party rather than dropped.

- id: conflicts.matching-engine.strictness
  name: Configurable strictness
  scope: Balanced default with an over-inclusive fuzzy/phonetic/alias mode a firm can enable.
  status: shipped
  slices: 4-1-conflicts
  evidence: packages/conflicts/src/settings.ts (resolveScope, floorStrictness) + matching.ts (matchOptionsFor) — over_inclusive is a strict superset of balanced, proven by a dedicated test.

- id: conflicts.search-depth
  name: Configurable search depth
  scope: Structured Directory/matter scan by default; optional document-content scan.
  status: partial
  slices: 4-1-conflicts
  evidence: packages/conflicts/src/settings.ts (defaultDepth) + expansion.ts (graph traversal to a configured depth). The optional document-content scan (the content source class) is registered but not yet available — no corpus exists.

- id: conflicts.firm-wide-scope
  name: Firm-wide imputation
  scope: Conflicts impute across the whole firm and every office; locations never partition the conflicts graph.
  status: shipped
  slices: 4-1-conflicts
  evidence: packages/conflicts/src/settings.ts — the party source class is an unconditional floor (always unioned back in, never firm/office-scoped down); imputation.ts joins firm members by identity, not by office.

- id: conflicts.clearance
  name: Human clearance
  scope: Reviewer adjudicates hits; clearance records waiver obtained or ethical wall erected.
  status: shipped
  slices: 4-1-conflicts
  evidence: packages/conflicts/src/disposition.ts (recordDisposition — cleared / waiver obtained / wall erected / representation declined) + conflicts:dispose permission.
  notes: Backend + API only; reviewer adjudication UX is deferred (status.d/slice-4-1-conflicts.md).

- id: conflicts.log
  name: Immutable conflicts log
  scope: Every check and clearance recorded in an immutable, defensible log.
  status: shipped
  slices: 4-1-conflicts
  evidence: Three per-firm append-only tables (conflicts_check, conflicts_hit, conflicts_disposition) with RAISE(ABORT) triggers guarding UPDATE/DELETE, proven by assertConflictsFitness and packages/database/test/conflicts-append-only.test.ts. Identifiers recorded by reference only, never plaintext.
