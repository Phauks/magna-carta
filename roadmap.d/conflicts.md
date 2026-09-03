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
  evidence: packages/conflicts on main — the check orchestrator, the six comparison channels over the Directory corpus, the append-only three-table log, the disposition stream, the re-check ledger and its consumers, plus apps/api-worker/src/routes/conflicts.ts. The web surface is built (apps/web/src/lib/conflicts and the routes under /conflicts); what it is short of is READS rather than screens, tracked on conflicts.read-surface. The intake trigger still has no intake flow to fire from.
  audience: public
  public-name: Conflicts checking
  public-summary: Check a prospective client or matter against everyone the firm has acted for or against, and keep a permanent record of what the check returned and who cleared it.
  awaiting-owner: Two of the deepening design's calls still decide what the platform asserts about a firm's ethical position rather than how it is coded. Whether an imputed conflict follows a lateral hire, and whether a screen cures it, which decides whether the personnel trigger produces a conflict or a screening prompt and whether screening is modelled at all. And whether a matter may refuse to open over undisposed tier-1 hits, or only advise loudly — a hard block is the platform making an ethics judgement, and no block means a firm can open a file over an unanswered exact-identifier match. Conflicts deepening design, flags F2 and F11. A third, whether the balanced band searches former, maiden and alias names, no longer blocks anything: ConflictsPolicy.balancedNameRoles in packages/conflicts/src/settings.ts ships the design's recommended answer as a firm setting recorded verbatim on every check row, so answering it either way is a settings edit rather than a release (flag F1).

- id: conflicts.directory-seams
  name: Directory matching seams
  scope: Name normalization, phonetic keys, entity search, and duplicate-detection/merge machinery in the Directory.
  status: shipped
  surface: internal
  slices: 1-3-directory, 1-4-custom-fields-engine
  adrs: ADR-0085, ADR-0086
  evidence: packages/directory/src (normalize-name.ts, phonetics.ts, search.ts, merge.ts) on main, plus the derivation the deepening added beside the frozen normalization — match-key.ts producing the normalized_match_key and normalized_match_key_bare columns on directory_name, computed inside insertNameStatement in packages/directory/src/statements.ts so no name-writing path can omit them, filled for existing corpora by the resumable budgeted sweep in packages/directory/src/name-index-backfill.ts, and audited by findNamesMissingDerivedMatchingData in packages/directory/src/fitness.ts. Held by match-key.test.ts and name-index-backfill.test.ts in packages/directory/test.

- id: conflicts.triggers
  name: Check triggers
  scope: Run checks at intake, whenever a party is added, and on optional periodic re-scans.
  status: partial
  surface: internal
  slices: slice-4-1-conflicts
  evidence: The add-a-party and corpus-change triggers and the scheduled re-scan shipped — packages/conflicts/src/recheck-cause.ts and recheck-request.ts over the Directory outbox topics, the two consumers in apps/api-worker/src/conflicts/, and apps/api-worker/src/conflicts/periodic-rescan.ts; TRIGGER_BY_TOPIC already records a matter.created check as preliminary and a matter.opened or matter.reopened one as comprehensive. Missing is the check that runs BEFORE a matter exists to raise an event about — the pre-engagement screen an intake flow would fire, which no topic can reach because there is no matter row yet.

- id: conflicts.matching-engine
  name: Matching engine
  scope: Candidate generation over names and identifiers (exact identifier, exact normalized name, organization match keys, Double Metaphone, trigram) with related-party edge expansion, ordered by evidence tier.
  status: shipped
  slices: slice-4-1-conflicts
  adrs: ADR-0013
  spec: docs/specs/2026-07-09-slice-4-1-conflicts-design.md
  evidence: packages/conflicts/src/matching.ts runs six blocking channels over the Directory corpus — blind-index identifier equality with no decrypt, an exact normalized-display probe, the two organization match-key probes (normalized_match_key at tier 2, normalized_match_key_bare at tier 3, sharing one implementation with the exact-name probe so the three cannot come to scope differently), and the directory's phonetic and trigram channels — and matchPartyBatch runs each of them ONCE over a whole expanded closure through findDuplicateCandidatesBatch in packages/directory/src/search.ts, with readSubjectFactsBatch reading the closure's node rows in one query per table; packages/conflicts/src/expansion.ts walks related-party edges with a budget per edge class where corporate parent/subsidiary/successor hops cost nothing, and packages/conflicts/src/evidence.ts assigns each candidate its tier; packages/conflicts/src/run-check.ts composes them, held by matching.test.ts, expansion.test.ts matching-depth.test.ts and matcher-equivalence.test.ts in packages/conflicts/test — the last proving the batched matcher returns exactly the per-entity matcher's hit set over a real corpus carrying every channel's shape, and asserting per channel that it fired at all, which is what allows the batching to exist and what stops a dead channel reading as coverage.
  notes: Backend only, no screen. Deliberately scorer-free — a tier orders evidence and never filters, so raising strictness can only add hits; the under-specification the white paper flagged was answered by the two conflicts design specs rather than left open. One named gap remains and it is measured rather than assumed: the phonetic channel encodes ENGLISH pronunciation, so cross-origin surname variants (Nowak/Novak, Kowalczyk/Kovalchik) are structurally out of its reach. A Beider-Morse channel would close seven such pairs in a thirty-pair corpus; it is unbuilt because the only pure-TypeScript encoder compiles its rule tables in 20,377 ms inside workerd against 16 ms in Node, which is past the CPU limit. The follow-on is the Rust/WASM port, with that number as its flip condition.

- id: conflicts.matching-engine.strictness
  name: Configurable strictness
  scope: Balanced default with an over-inclusive fuzzy/phonetic/alias mode a firm can enable, and the name roles each band compares against as a firm setting recorded on the check row.
  status: partial
  surface: awaiting-screen
  slices: slice-4-1-conflicts
  evidence: The two levels are a typed vocabulary in packages/conflicts/src/types.ts; matchOptionsFor in packages/conflicts/src/matching.ts picks the channels and name roles each level sees, and over_inclusive is a structural superset by construction — it searches every name role and is deliberately not configurable, while ConflictsPolicy.balancedNameRoles in packages/conflicts/src/settings.ts makes the narrower band's role set a firm setting defaulting to current, former, maiden and alias, so a party who married and changed surname is found at the default band. The phonetic axis widens the same way: matchOptionsFor narrows balanced to the Double Metaphone PRIMARY code alone, while over_inclusive passes no scheme filter and so sees primary and secondary both. Beider-Morse runs at neither band — it is unbuilt, for the reason recorded on conflicts.matching-engine. resolveScope raises a per-run request to the firm's floor and records floorRaised, and runConflictsCheck writes inputs_json.matching with the name keys compared, the phonetic schemes that ran and the resolved roles, so a reader of an old row does not have to know what the preset word meant that day. Held by packages/conflicts/test/matching.test.ts, which drives the narrowed setting as well as the default.
  notes: Partial because the firm floor itself has no write path — readConflictsPolicy in packages/conflicts/src/settings.ts reads the conflicts.policy setting row and no route or screen sets it, so a firm changes its floor only by writing that row directly.

- id: conflicts.search-depth
  name: Configurable search depth
  scope: Structured Directory/matter scan by default, deep in two independent axes — how far the graph is walked and how a name is compared; optional document-content scan.
  status: partial
  surface: awaiting-screen
  slices: slice-4-1-conflicts
  evidence: The structured scan is the party, graph and imputation source classes registered in packages/conflicts/src/sources.ts, and traversal depth is configurable per KIND of relationship rather than by one number — ConflictsPolicy.edgeClassBudgets and closureCap in packages/conflicts/src/settings.ts over the edge-class map in packages/conflicts/src/edge-classes.ts, both firm settings with per-run overrides on the check request, both resolved by resolveScope and written verbatim into the check row's inputs_json. expandGraph in packages/conflicts/src/expansion.ts spends each class's budget separately while corporate parent/subsidiary/successor hops stay free and transitive, traverses edges whose validity has ended and marks the expiry on the path step, and on reaching the closure cap stops and returns a truncation record the check row carries, the posture read reports on latestCheck.scope.traversal, and describeCheck states in words as an incomplete search. Held by packages/conflicts/test/expansion.test.ts, including the refusal of degree-based hub suppression.
  notes: The matching axis lands with the traversal one — the two organization match keys and the resolved channel set recorded verbatim on the check row (see conflicts.matching-engine and conflicts.matching-engine.strictness); the cross-origin surname encoder is measured-and-deferred, recorded on that node. The nickname equivalence dimension is registered and empty: the nickname_equivalence table exists, holds nothing, and NICKNAME_EQUIVALENCE_SOURCE in packages/conflicts/src/sources.ts makes every check record it as a source it could not search, read from the catalogue by nicknameCatalogueIsPopulated in packages/directory/src/nickname.ts rather than asserted. Partial because the content class has no corpus behind it — availabilityOf in packages/conflicts/src/sources.ts records it unavailable on every check and unavailabilityReason states why, so the log can never read as searched-and-clean for document text. Backend only, no screen. The firm-marked non-expandable entity, the recorded and attributable alternative to a hub heuristic, is not built: it needs a Directory write path.

- id: conflicts.firm-wide-scope
  name: Firm-wide imputation
  scope: Conflicts impute across the whole firm and every office; locations never partition the conflicts graph.
  status: shipped
  surface: internal
  slices: slice-4-1-conflicts
  evidence: findImputationHits in packages/conflicts/src/imputation.ts joins the firm's members to a matter's parties by identity through the member_id link on the directory entity — never by name similarity — and a deactivated member still imputes; readConflictsPolicy in packages/conflicts/src/settings.ts unions the party class back into the floor on every read, so a stored policy cannot drop the firm-wide corpus. Held by packages/conflicts/test/imputation.test.ts and settings.test.ts.
  notes: Backend only, no screen. The package names no location column and takes no office argument on any path, so there is no seam through which a location filter could partition the graph.

- id: conflicts.clearance
  name: Human clearance
  scope: Reviewer adjudicates hits; clearance records waiver obtained or ethical wall erected.
  status: shipped
  surface: awaiting-screen
  slices: slice-4-1-conflicts
  evidence: recordDisposition in packages/conflicts/src/disposition.ts appends one conflicts_disposition row per adjudication across the four kinds (cleared, waiver_obtained, wall_erected, representation_declined), refusing a blank rationale and an unknown hit, behind POST /api/v1/conflicts/hits/{hitId}/dispositions on conflicts:dispose; readHitDispositionStates resolves every hit's current word in one query, and the matter posture read reports hits no reviewer has answered by evidence tier alongside how the answered ones were disposed of and by whom.
  notes: Backend only, no review screen. A reversal is a second row rather than an edit, so the whole adjudication history stays on the books; wall_erected records that a wall was put in place and enforces no access restriction by itself. packages/conflicts/test/automated-path-cannot-dispose.test.ts proves no automated trigger can dispose of anything.

- id: conflicts.log
  name: Immutable conflicts log
  scope: Every check and clearance recorded in an immutable, defensible log.
  status: shipped
  surface: awaiting-screen
  slices: slice-4-1-conflicts
  evidence: Three append-only per-firm tables — conflicts_check, conflicts_hit and conflicts_disposition in packages/database/src/per-firm-schema.ts — each carrying BEFORE UPDATE, BEFORE DELETE and a BEFORE INSERT guard against REPLACE, asserted by packages/database/test/conflicts-append-only.test.ts and probed at runtime by assertConflictsFitness in packages/conflicts/src/fitness.ts. A check row records the trigger, its source, the accumulated causes, the scope asked for against the scope that ran, the strictness, the depth and whether the floor was raised; packages/conflicts/src/report-text.ts renders that into the plain-language statement GET /api/v1/conflicts/checks/{checkId} returns beside the hits.
  notes: Backend only, no screen reads it. The entry format the white paper left open is now the schema, and the fitness probes also refuse a plaintext-identifier-shaped digit run in a recorded input or evidence string — the log records what was searched, never the identifier value that drove it.

- id: conflicts.read-surface
  name: Reading the log back
  scope: The reads the conflicts screens are built against — naming the party a hit is about, the full adjudication trail, the firm's own policy floor, the checks a firm has run, an earlier answer about the same party, and asking for a re-check on demand.
  status: partial
  surface: screen
  spec: docs/specs/2026-09-02-conflicts-read-surface-design.md
  evidence: Five of six built. GET /api/v1/conflicts/checks/{checkId} now resolves every hit's entity through readEntityDisplayNames in packages/conflicts/src/subject-facts.ts and carries a `party` on each hit — the name the Directory holds today, resolved on the read rather than copied onto the append-only log. The same change replaced two N+1s: the handler was calling readCurrentDisposition per hit inside a Promise.all (readHitDispositionStates answers the whole check in one query, and its own comment names the per-hit loop as the mistake), and the checks screen was spending one Directory read per hit a reviewer opened. Held by packages/conflicts/test/entity-display-names.test.ts and two route tests, including the unresolved-entity path a merge makes reachable. GET /api/v1/conflicts/hits/{hitId}/dispositions then added the adjudication trail — readDispositionTrail in packages/conflicts/src/disposition.ts, oldest first with the same rowid tie-break readCurrentDisposition uses, so a reversed answer stays readable beside the one that replaced it. The hit's existence is checked so an empty trail can only mean nobody has answered it. POST /api/v1/matters/{matterId}/conflicts-rechecks then added the on-demand re-check on conflicts:run — no scope field, because the firm's floor is what runs and a scope field would invite a screen to compose a narrower search than the firm requires; no subject list, because runConflictsCheck reads the matter's live parties. GET /api/v1/firm/conflicts-policy serves readConflictsPolicy on conflicts:read, and the check runner states the floor rather than marking it unreadable. GET /api/v1/conflicts/checks then added the firm's check history — keyset-paged over (created_at, id) through selectConflictsChecksStatement, optionally narrowed by matter. Its load-profile plan probe measured the UNFILTERED listing as a full table scan of conflicts_check on the first run, exactly as the design predicted, because the existing index leads with subject_matter_id; conflicts_check_created_id_index was added in the same change and both shapes are now probed separately.
  notes: PARTIAL because one read remains — a re-surfaced hit's earlier conclusion.
