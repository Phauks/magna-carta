# Conflicts Check

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Conflicts -->

- id: conflicts
  name: Conflicts Check
  scope: Firm-wide conflict checking across the Directory graph and matter role-links, with configurable strictness/depth, human clearance, and an immutable log.
  status: partial
  slices: slice-4-1-conflicts
  adrs: ADR-0013
  spec: docs/specs/2026-07-09-slice-4-1-conflicts-design.md
  evidence: packages/conflicts on main — the check orchestrator, the four blocking channels over the Directory corpus, the append-only three-table log, the disposition stream, the re-check ledger and its consumers, plus apps/worker/src/routes/conflicts.ts. No web surface yet, and the intake trigger has no intake flow to fire from.
  audience: public
  public-name: Conflicts checking
  public-summary: Check a prospective client or matter against everyone the firm has acted for or against, and keep a permanent record of what the check returned and who cleared it.

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
  status: partial
  slices: slice-4-1-conflicts
  evidence: The add-a-party and corpus-change triggers and the scheduled re-scan shipped — packages/conflicts/src/recheck-cause.ts and recheck-request.ts over the Directory outbox topics, the two consumers in apps/worker/src/conflicts/, and apps/worker/src/conflicts/periodic-rescan.ts. The intake trigger is the one that has no caller, because the intake flow that would fire it is unbuilt.

- id: conflicts.matching-engine
  name: Matching engine
  scope: Candidate generation and scoring over names/identifiers (exact, fuzzy, phonetic, alias/blind-index) with related-party edge expansion.
  status: researching
  adrs: ADR-0013
  evidence: White paper flags the engine as under-specified for an ethics-critical feature; a follow-up spec is required and does not exist.
  notes: Phonetic and normalization primitives already shipped in packages/directory.

- id: conflicts.matching-engine.strictness
  name: Configurable strictness
  scope: Balanced default with an over-inclusive fuzzy/phonetic/alias mode a firm can enable.
  status: not-started
  evidence: No strictness configuration exists; depends on the unspecified matching engine.

- id: conflicts.search-depth
  name: Configurable search depth
  scope: Structured Directory/matter scan by default; optional document-content scan.
  status: not-started
  evidence: No depth configuration or document-content scan path exists.

- id: conflicts.firm-wide-scope
  name: Firm-wide imputation
  scope: Conflicts impute across the whole firm and every office; locations never partition the conflicts graph.
  status: not-started
  evidence: No conflicts graph exists to scope; Directory and Locations models are in place as substrate.

- id: conflicts.clearance
  name: Human clearance
  scope: Reviewer adjudicates hits; clearance records waiver obtained or ethical wall erected.
  status: not-started
  evidence: No clearance workflow or UI exists.

- id: conflicts.log
  name: Immutable conflicts log
  scope: Every check and clearance recorded in an immutable, defensible log.
  status: not-started
  evidence: No conflicts log schema or write path exists; entry format is explicitly unspecified in the white paper.
