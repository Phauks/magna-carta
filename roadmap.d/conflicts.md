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
  awaiting-owner: The deepening design is written and unbuilt, and three of its calls decide what the platform asserts about a firm's ethical position rather than how it is coded. Whether the balanced default searches former, maiden and alias names — today only the over-inclusive band does, so a married-name change is invisible at the setting nearly every firm will run. Whether an imputed conflict follows a lateral hire, and whether a screen cures it, which decides whether the personnel trigger produces a conflict or a screening prompt and whether screening is modelled at all. And whether a matter may refuse to open over undisposed tier-1 hits, or only advise loudly — a hard block is the platform making an ethics judgement, and no block means a firm can open a file over an unanswered exact-identifier match. Conflicts deepening design, flags F1, F2 and F11.

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
  evidence: The add-a-party and corpus-change triggers and the scheduled re-scan shipped — packages/conflicts/src/recheck-cause.ts and recheck-request.ts over the Directory outbox topics, the two consumers in apps/worker/src/conflicts/, and apps/worker/src/conflicts/periodic-rescan.ts; TRIGGER_BY_TOPIC already records a matter.created check as preliminary and a matter.opened or matter.reopened one as comprehensive. Missing is the check that runs BEFORE a matter exists to raise an event about — the pre-engagement screen an intake flow would fire, which no topic can reach because there is no matter row yet.

- id: conflicts.matching-engine
  name: Matching engine
  scope: Candidate generation over names and identifiers (exact identifier, exact normalized name, phonetic, trigram) with related-party edge expansion, ordered by evidence tier.
  status: shipped
  slices: slice-4-1-conflicts
  adrs: ADR-0013
  spec: docs/specs/2026-07-09-slice-4-1-conflicts-design.md
  evidence: packages/conflicts/src/matching.ts runs the four blocking channels over the Directory corpus — blind-index identifier equality with no decrypt, an exact normalized-display probe, and the directory's phonetic and trigram channels — packages/conflicts/src/expansion.ts walks related-party edges as a 0-1 BFS where corporate parent/subsidiary/successor hops cost nothing, and packages/conflicts/src/evidence.ts assigns each candidate its tier; packages/conflicts/src/run-check.ts composes them, held by matching.test.ts and expansion.test.ts in packages/conflicts/test.
  notes: Backend only, no screen. Deliberately scorer-free — a tier orders evidence and never filters, so raising strictness can only add hits; the under-specification the white paper flagged was answered by the two conflicts design specs rather than left open.

- id: conflicts.matching-engine.strictness
  name: Configurable strictness
  scope: Balanced default with an over-inclusive fuzzy/phonetic/alias mode a firm can enable.
  status: partial
  slices: slice-4-1-conflicts
  evidence: The two levels are a typed vocabulary in packages/conflicts/src/types.ts; matchOptionsFor in packages/conflicts/src/matching.ts picks the channels and name roles each level sees, so over_inclusive is a structural superset that also reads former names and aliases; resolveScope in packages/conflicts/src/settings.ts raises a per-run request to the firm's floor and records floorRaised on the check row, and the matter posture read reports a check that ran below the current floor. A caller selects it per run in the scope object on POST /api/v1/conflicts/checks.
  notes: Partial because the firm floor itself has no write path — readConflictsPolicy in packages/conflicts/src/settings.ts reads the conflicts.policy setting row and no route or screen sets it, so a firm changes its floor only by writing that row directly.

- id: conflicts.search-depth
  name: Configurable search depth
  scope: Structured Directory/matter scan by default; optional document-content scan.
  status: partial
  slices: slice-4-1-conflicts
  evidence: The structured scan is the party, graph and imputation source classes registered in packages/conflicts/src/sources.ts, and traversal depth is configurable end to end — ConflictsPolicy.defaultDepth in packages/conflicts/src/settings.ts, an optional per-run depth on the check request capped at six hops, expandGraph in packages/conflicts/src/expansion.ts honoring it while corporate hops stay free, and the resolved depth written to every conflicts_check row so the posture read can report a check that ran shallower than the firm default.
  notes: Partial because the content class has no corpus behind it — availabilityOf in packages/conflicts/src/sources.ts records it unavailable on every check and unavailabilityReason states why, so the log can never read as searched-and-clean for document text. Backend only, no screen.

- id: conflicts.firm-wide-scope
  name: Firm-wide imputation
  scope: Conflicts impute across the whole firm and every office; locations never partition the conflicts graph.
  status: shipped
  slices: slice-4-1-conflicts
  evidence: findImputationHits in packages/conflicts/src/imputation.ts joins the firm's members to a matter's parties by identity through the member_id link on the directory entity — never by name similarity — and a deactivated member still imputes; readConflictsPolicy in packages/conflicts/src/settings.ts unions the party class back into the floor on every read, so a stored policy cannot drop the firm-wide corpus. Held by packages/conflicts/test/imputation.test.ts and settings.test.ts.
  notes: Backend only, no screen. The package names no location column and takes no office argument on any path, so there is no seam through which a location filter could partition the graph.

- id: conflicts.clearance
  name: Human clearance
  scope: Reviewer adjudicates hits; clearance records waiver obtained or ethical wall erected.
  status: shipped
  slices: slice-4-1-conflicts
  evidence: recordDisposition in packages/conflicts/src/disposition.ts appends one conflicts_disposition row per adjudication across the four kinds (cleared, waiver_obtained, wall_erected, representation_declined), refusing a blank rationale and an unknown hit, behind POST /api/v1/conflicts/hits/{hitId}/dispositions on conflicts:dispose; readHitDispositionStates resolves every hit's current word in one query, and the matter posture read reports hits no reviewer has answered by evidence tier alongside how the answered ones were disposed of and by whom.
  notes: Backend only, no review screen. A reversal is a second row rather than an edit, so the whole adjudication history stays on the books; wall_erected records that a wall was put in place and enforces no access restriction by itself. packages/conflicts/test/automated-path-cannot-dispose.test.ts proves no automated trigger can dispose of anything.

- id: conflicts.log
  name: Immutable conflicts log
  scope: Every check and clearance recorded in an immutable, defensible log.
  status: shipped
  slices: slice-4-1-conflicts
  evidence: Three append-only per-firm tables — conflicts_check, conflicts_hit and conflicts_disposition in packages/database/src/per-firm-schema.ts — each carrying BEFORE UPDATE, BEFORE DELETE and a BEFORE INSERT guard against REPLACE, asserted by packages/database/test/conflicts-append-only.test.ts and probed at runtime by assertConflictsFitness in packages/conflicts/src/fitness.ts. A check row records the trigger, its source, the accumulated causes, the scope asked for against the scope that ran, the strictness, the depth and whether the floor was raised; packages/conflicts/src/report-text.ts renders that into the plain-language statement GET /api/v1/conflicts/checks/{checkId} returns beside the hits.
  notes: Backend only, no screen reads it. The entry format the white paper left open is now the schema, and the fitness probes also refuse a plaintext-identifier-shaped digit run in a recorded input or evidence string — the log records what was searched, never the identifier value that drove it.
