---
branch: claude/passive-dev-orchestrator-m7f9jw
worktree: (remote session — orchestrator)
area: cross-stream orchestration — status truth, roadmap, delegated slices, review-fix campaign
status: building
touches: docs/active-work/ (sweeps), docs/deploy-queue.md, status.d/ (merged-stream repairs), .claude/settings.json, delegated agent branches (each with its own note)
---

Long-lived orchestration stream running while the owner is away. This note doubles
as the **revival document**: everything a fresh context or container needs to resume
at full capacity. Keep it current at every milestone — it is the durable memory.

## Mandate (owner decisions, 2026-08-04, all recorded in-session)

- **Full-program authorization** — any backend slice, any fix, any phase 0-7.
- **UI surfaces deferred to the owner** (they have opinions). Backend seams only.
- **Production deploys never** (`git push origin main:release` forbidden; deny rule
  enforces it). Pending activations accumulate in `docs/deploy-queue.md`.
- **Merges allowed** once the gate is green and a review passed. Merge explicitly via
  the GitHub API; repo auto-merge is not relied on.
- **Golden-rule-14 consent granted** for the LibreOffice conversion engine
  (C++ in a network-isolated Container, the Collabora precedent).
- **Invariant-heavy designs** (trust accounting 3·2, crypto/compliance calls like
  protected-column changes) get analysis + a written flag for owner review, not
  unilateral build.
- **Standing "dream" directive**: continually look for improvements and expanded
  functionality; confirm tools are genuinely useful; capture ideas in the status
  artifact's ideas ledger; promote mature ones to ROADMAP's interest list or a spec.
- Build modularly; spec-first for new slices (golden rule 8); no emojis; no
  process-artifact references in code (never cite F-NNN finding ids in source).

## Standing infrastructure

- **Status artifact** (owner-visible log, update at every milestone):
  https://claude.ai/code/artifact/494243b6-b656-47bf-be52-25e1b33f68e3
  (republish the scratchpad file `orchestrator-status.html`; if the scratchpad is
  gone after a restart, rebuild the page from this note + git history and republish
  with the `url` parameter to keep the same link).
- **Hourly heartbeat routine** `trig_01Kc6QhpUarReG4qmirNxbkc` (fires :09) — carries
  the full standing instructions; it revives this session after usage gaps.
- **Permission allowlist** committed in `.claude/settings.json` (this branch):
  git/pnpm/node/cargo, both tool servers, file/agent tools; deny guards on deploy
  paths and force-pushes to main.
- Weekly routines that exist and are healthy: docs-sync (Mon 14:05 UTC), a second
  MC docs-sync (Mon 13:03), Cloudflare blog monitor (daily 14:00, reports not
  persisted), dependency updates (Mon 14:30).

## Position update (2026-08-05 ~11:10 UTC) — owner's wave fully shipped, audit closed

Seventy-three merged. The owner's entire selected wave is on main: trust 3·2·1
foundation (#105), DKIM + add-in hardening (#106), 1-core ubuntu-slim runners
(#107), 2·6·3 letterhead + custom-field bindings (#109), custodian gated release
(#110), expression aggregates (#111 — sum/minimum/maximum full names; RULING:
aggregate over an empty list = declared absence, a sum of no money cannot invent
a currency; item-missing-field = unresolved, never skipped), and the
binary-idempotency audit + documentAutomation load profile (#112, tasks 57+64
closed). #112 outcome: ZERO live required+binary hits across 105 required-
idempotency and 10 octet-stream operations; enforcement shipped at three depths
(defineOpenAPIRoute startup guard, conformance rule over the emitted doc, source
scan over routes/ — the third prong exists because `fileIntegrity.hash` and
`scan.diagnose` stream `c.req.raw.body` while declaring NO body, invisible to a
document-level rule; that contract inaccuracy is task 66, its own slice since it
moves snapshot + client). Load profile v9: 181 templates / 479 versions / 1,605
assemblies, all four hot paths index walks, scan allowlist EMPTY;
merge-context median 0.741 ms tracks source count, not field count. Trust
fitness deliberately NOT wired — the profile lays only subledger accounts;
3·2 gets its own load-profile stage. GOTCHA reconFIRMED 3×: identical-timestamp
migration collisions between parallel branches (second-to-merge retags +1s) —
#94/#98, trust/email at 120000, custodian-3/2·6·3 at 130000; always check the
journal tail before merging a migration-bearing PR. fix:scoped struck again in
#112 (~35 lines incl. security-guard boolean churn — reverted; task 54 open).
Queue: #54 tooling pair, 3·2·2 trust movements (check T4/T5 partial answers;
unanswered T-flags ship recommended-default + flagged), custodian 4·2·4
stocktake, directory role sources, add-in client API, task 66. Austerity
unchanged (merge bar = full local suites + review; revert = task 61, reset date
still unknown — owner-ask).

## Position update (2026-08-05 ~09:30 UTC) — day-2 morning: owner decisions, austerity, trust foundation

Sixty-eight merged. OWNER DECISIONS 2026-08-05 (all in session): G1-G5 expression
defaults RATIFIED + aggregates (sum/count/min/max) APPROVED as a follow-up slice;
TRUST AUTHORIZED — T1 client-to-matter-leaves tree, T17 build before the pre-beta
baseline; CI BUDGET: Actions minutes exhausted (runs fail with runner_id 0 —
hard-down), owner chose MERGE ON LOCAL VERIFICATION (agent full local suites +
orchestrator review) and SUSPEND the whole-repo lint entirely; austerity landed
(#103, grep "TEMPORARY CI AUSTERITY 2026-08-05" to revert + one dispatched full
gate before trusting main — task 61); Cloudflare CI question answered (#104):
DO NOT MIGRATE (10% of billable minutes port; skipped builds emit no check run —
never make a Cloudflare check required); better levers: 1-core ubuntu-slim
runners for short jobs (LANDED #107, ~$20-60/mo) and the lint dependency-fanout
(43% of the bill — task 63, needs design). MERGED this morning: trust 3·2·1
foundation (#105 — every invariant by construction, T2-T16 seamed, transfers
refuse by default pending T4); DKIM verifier + add-in hardening (#106 — journal
idx 25 after an identical-timestamp retag to 120002; the chokepoint idempotency
gate TEXT-DECODES cached bodies, mangling binary uploads — route kept optional +
handler-side, audit task 64); drizzle snapshots repaired (#102 — refresh script +
check-snapshots + NEW RULE in packages/database/CLAUDE.md: hand-written
migrations refresh the snapshot same commit). Building: 2·6·3 letterhead +
custom-field bindings, custodian slice 3. Queue: aggregates slice, load profile
(task 57), tooling pair (54), binary-idempotency audit (64), snapshot format fix

- ubuntu-slim validation (65, folds into austerity revert). Owner ledger:
  F2-F5/F9, C4-C11, G6-G8, T2-T16 per-slice, ADR-0109 + transcript-as-client-record,
  deploy queue, Renovate, stale branches, bot self-merge, Actions RESET DATE
  UNKNOWN — ask the owner when visible.

## Position update (2026-08-05 ~03:20 UTC) — evening wave complete

Fifty-nine merged through 08-05 01:45Z; the evening wave (#91-#98) all landed:
the owner's consent overrules (#94 — merge-field absence-visibility, opt-in
macro strip, per-firm mapping library), office-crypto replaced in-house (#95 —
sixteen crates gone, ZERO accepted Rust advisories remain), the template
expression language designed to the owner's expanded ceiling (#92 — flags
G1-G8 pending, G1 unresolved-condition default and G4 aggregates the notable
ones), the Cloudflare Agents assessment corrected against all 123 doc pages
(#91 — verdict: keep our Durable Objects, harvest DO-native push-progress, an
assistant surface gates on ADR-0109 + the transcript-as-client-record
question), fix:scoped + the stack-demand guard (#93), the trust accounting
analysis (#97 — owner checklist T1-T17; discoveries: the approved
jurisdiction-profile design was never built and its 56-jurisdiction corpus
never vendored; trust creates the first real chart-of-accounts rows, a pin
the phase-3 map lacked), and custodian slice 2 (#98). Now building:
push-progress WebSockets (claude/push-progress-websockets, task 55) and the
2·6·2 conditionals slice (claude/automation-conditionals-slice, task 56, with
recommended defaults applied and flagged). Queued: drizzle snapshot repair
(task 53), fix:scoped/vp-test tooling pair (task 54), pre-beta baseline
(task 45, owner-timed).

NEW GOTCHAS from the wave: parallel migrations sharing a timestamp prefix —
retag the second-to-merge +1 second to keep tag ordering total (the #94/#98
case); widening a CHECK constraint means rebuilding the table in SQLite —
re-prove append-only triggers against the rebuilt table and carry the
expand-contract annotation; fix:scoped's lint autofix rewrites .sort() to
.toSorted() even outside ES2022 lib targets and makes drive-by edits — review
its diff before committing (task 54); two concurrent vp test invocations
deadlock at 0% CPU — serialize them; `vp test run --project X -- filter`
hangs — pass paths, not positional filters.

## Day-end position (2026-08-04 ~19:15 UTC)

Forty-seven pull requests merged. The whole-program-review fix campaign is
COMPLETE (all ten batches + every confirmed-open residue item). The October
advisory deadline is resolved early (#77: uuid fixed by pnpm override,
quick-xml quadratic scan mitigated by a 64 KiB descriptor cap in
decryption-core, lopdf 0.44 taken; the named exit is replacing office-crypto —
its own slice). The LibreOffice engine, the tooling/hygiene batches, the
telemetry runtime fixes, and the file-manager residue all landed.

THE OWNER RETURNED mid-day and decided: F1 braces are the one canonical
placeholder form with MERGEFIELD CONVERTED at registration (opt-in, see
below); F7 in-house TypeScript OOXML engine; F8 macros accepted-and-stripped
(deviation from spec recommendation, security-boundary tests required);
custodian C1/C2/C3 all as recommended. NEW BINDING POSTURE (ADR on main,
`consensual-guided-data-conversion`): data conversion into the platform is
consensual and guided — detection/reporting always on, conversion opt-in,
never silent; confirmations accumulate as per-firm mapping libraries. The
owner also AUTHORIZED the field-input UI infrastructure carve-out (delivered:
#87 — merge-field catalog contract + design-system picker components +
assembly input area over a mock provider; one file swaps when the real API
wires up), and stated: no production firms exist, so migration ceremony is
low-stakes and the schema gets condensed to a fresh baseline pre-beta (task
45, owner-timed).

Built on those decisions same-day: custodian slice 4·2·1 (#86 — packet
register, location tree, trigger-enforced append-only movements, custody
numbering, journal idx 17/18) and document automation slice 2·6·1 (PR #88, in
reconciliation: template catalogue, registration-time normalization with
opt-in MERGEFIELD conversion and always-on detection, adversarial macro
stripping with independent re-verification, merge assembly through the ingest
chokepoint). #88's agent made two recorded judgment calls: macro stripping
stays unconditional (changes what a document DOES, not says) and unconverted
merge-field templates are REFUSED with the field list rather than registered
inert (frozen cached text is invisible to the absence model). The register
pipeline defect (#84) is fixed: fragment validation is loud, lint:decisions
gates PRs, ADR-0210-0213 restored whole with the owner's decisions recorded.

In flight: PR #88 merging main to renumber the migration journal (its
tags 20260804T150000/150001 sort before custodian's 160000/160001 — resolver
briefed), assembly bot PR #85. Queue after: task 40 (engine-host stack
overflow flake), 46 (fix:scoped script), 45 (pre-beta baseline, owner-timed),
then next slices by value — 2·6·2 conditionals, the per-firm field-mapping
library, the office-crypto replacement slice, 3·2 trust = analysis + owner
flag only. Owner-blocked: deploy queue, Renovate install, stale remote
branches, bot self-merge setting, custodian flags C4-C11 and automation flags
F2-F6/F9 (all non-blocking).

## Earlier snapshot (superseded, kept for the resume trail)

Merged today (14): #42 #29 #43 #35 #44 #45 #50 #47 #49 #52 #48 #51 #53 #54 —
the whole inherited backlog, the CI cost package (gate tiered + cached, nightly
sweep), the dependency refresh (hono security bump), fix batches
B1 B2 B3 B4 B7 B10, and the 2·4 conversion close-out. #41 closed superseded.
Audit standing: most of the 27 critical/high findings fixed on main; ledger
update still owed (sweep task).

Agents in flight at writing (die on restart — check branches/PRs; redispatch
from the batch specs if absent): B6 ingest custody
(`claude/fix-ingest-custody`), B8 matters numbering
(`claude/fix-matters-numbering`), B9 editing guards (PR #55 open), the mint
route (`claude/email-capture-mint-route`), and the 2·5 seal landing
(`claude/2-5-analysis-prep-0n2kxw`). Remaining queue: B5 shipping/whois after
the OpenAPI-touching PRs clear; the sweeps (tasks 21, 26, 27); the
linter-stream reconciliation (task 24); a fresh docs-sync (task 3); then the
LibreOffice engine (task 7) and the search write pipeline (task 8). Owner
asks are on the status artifact: install the Renovate app; optionally enable
a merge queue; the advisories lapsing 2026-10-14 (task 23). Operational
lessons: remove each agent's worktree at merge (the disk filled once); never
run vp check --fix repo-wide; resolve merge conflicts by hunk, never by
whole file.

## Fix campaign — whole-program review (the owner-designated work basis)

Source: `docs/research/2026-07-01-fable-whole-program-review.md` (F-001..F-173) +
verification ledger (same name + `-verification`). Triage 2026-08-04: ledger had
never been run; 27 confirmed-open critical/high; F-059 and F-120 likely fixed
already. **Update the verification ledger as each batch lands.**

Batches in order (details in task board; sequencing notes inline):

- **B1** (running) F-140, F-072 — tenancy. **B10** (running) F-031/157, F-073, F-109.
- **B2** pdf-core: F-162 split() keeps dropped pages via kept-page /Annots
  (generate.rs), F-163 surgery redaction never strips /Annots (redact.rs). Pure
  Rust; rebase over lopdf lockfile after #35 merges.
- **B3** metadata: F-126 inflate w/o bomb guard (detect.ts), F-127 move-range
  markers survive scrub (ooxml/walk.ts REMOVE_TAGS), F-128 thumbnail/customXml/
  settings.xml untouched, F-129 JPEG post-EOI bytes kept (image/jpeg.ts), F-130
  200MB cap > 128MiB isolate (guards.ts). Sweep F-131-137. After #43 merges.
- **B4** directory: F-079 chained merges unresolvable (no merged_into_id repoint),
  F-080 collision absorption hard-DELETEs edges/matter_party (merge.ts:345),
  F-081 assertEntityExists ignores status. Sweep F-082-087.
- **B5** shipping/whois: F-138 EasyPost Idempotency-Key assumption, F-139 insurance
  never sent (easypost/map.ts), F-142 reconnect impossible (needs DELETE route →
  OpenAPI regen — land AFTER other OpenAPI-touching branches), F-141 naive CIDR
  startsWith (whois/rdap.ts). Sweep F-143-151.
- **B6** ingest (after B1 — same bucket seam): F-071 committed bytes mutable in
  presign TTL / overwrite no-op (ingest-consumer.ts), F-060 strict MIME equality
  false-quarantines legacy Office (ingest-core.ts). Sweep F-061-070.
- **B7** custom-fields: F-088 no number_scale re-scale on convert (100x money
  corruption), F-089 setCustomFieldValue never reads definition. Sweep F-090-098.
- **B8** matters: F-043 counter backstop gap (needs allocation-table migration —
  coordinate slots), F-044 openMatterStatement missing status guard. Sweep F-045-053.
- **B9** editing: F-112 getFile prefers R2 current over token version
  (wopi-routes.ts), F-113 edit worker boots container on any nonempty host label.
- **Sweeps**: telemetry/fitness F-032-039 (widen console-ban to scan-worker);
  doc/lint lows F-007/038/087/119/172; libvips cluster F-121-125 re-scope as dead
  code (dispatch moved to conversion-engine.ts service bindings).

## Feature queue (from the five inherited handovers, distilled)

1. **Email capture mint/rotate route** (`emails:manageCaptureAddresses`) — the
   forward/CC entrance is merged but inert until this ships. Design constraints:
   per-firm write + outbox row in ONE transaction, relay dispatches control-plane
   `email_capture_route` insert (mint = per-firm-first, degrades gracefully);
   revocation = control-plane-first (fail closed); tokens server-minted, lowercase
   alphanumeric ~16-22 chars, global PK collision retry; `resource: "matter"`
   (catch-all kind is firm-scoped — decide binding deliberately); never return
   revoked token values casually. Reuse `findCaptureAddressByToken`,
   `insertEmailCaptureAddressStatement`, `routes/firms.ts` control-plane precedent.
   Regenerate OpenAPI + client same commit; conformance not-vacuous list; Miniflare
   e2e mint/revoke/rotate/replay + 403 + failure-ordering test; ADR fragment records
   the cross-database ordering. Then remove operations.md §2a fast-follow caveat.
2. **2·4 close-out branch** `claude/repo-status-roadmap-xhdvyb` (per-engine
   dispatch seam, tracking refresh, fitness repairs — all green per its author):
   merge main, review, PR, land. At merge: delete its active-work note; warn
   eyebrow-link/file-manager-primitives streams their status.d order slots
   renumbered (eyebrow-link 22→25).
3. **2·5 e-sign branch** `claude/2-5-analysis-prep-0n2kxw` (platform seal complete
   end to end, commit `0b4a3d1f`): review, PR, land. Deploy hazard already in
   deploy-queue (SIGN_SERVICE binding blocks app-worker deploy until
   magna-carta-sign exists). Next after landing: pyHanko/DSS independent validator
   conformance; timestamp/LTV + purchased-cert decision is owner-paired.
4. **LibreOffice engine (2·4f, consented)** — design doc first. Inputs settled in
   docs/research/in-app-conversion.md: LibreOfficeKit fork-pool (Collabora
   convert-to internals the model), one-conversion-per-instance, Carlito+Caladea
   baked in; open: LOK binding choice, pool sizing/health-recycle. Wiring surface:
   CONVERT_WORKER_ENGINE_IDS + engineTargetFor + new Container class. Email→PDF
   render engine rides this container (network-isolated, inline only own CID parts,
   never wkhtmltopdf).
5. **Search write pipeline** — add document_id+version to index_split (new per-firm
   migration), deterministic split ids, delete-then-insert re-index, queue consumer
   copying the ConversionJob shape, dead-letter on failure. Then apps/search-worker
   (mirror scan-worker; warm cache; RangeReader over R2 range GETs; /index /query
   /remove), then Vectorize namespace-per-firm, then the API route (after engine).
6. After queue: next backend slices by value — 2·6 document automation, 4·2
   custodian; 3·2 trust = analysis + owner flag.

## Gotchas (each cost someone real time — do not relearn)

- Deleting a docs/active-work note requires flipping its status.d fragment to
  `branch: main` + empty `active-work:` in the SAME commit (lint:status).
- pnpm overrides ONLY in pnpm-workspace.yaml; package.json pnpm.overrides silently
  breaks the vitest alias chain ("Vitest failed to find the runner"). Plain
  `pnpm install`, never --no-frozen-lockfile.
- Control-plane migrations are generated (drizzle-kit + timestamp script) and need
  the map entry in control-plane-migrations.ts; per-firm journal conflicts: keep
  both, renumber idx monotonic. drizzle-kit diffs against the tracked baseline —
  hand-extract only the new DDL. Generated snapshots need oxfmt (vp check --fix).
- Never `vp check --fix` blind over worker/ES2022 packages (.sort→.toSorted breaks).
- Fresh worktrees: `vp run bootstrap` before anything importing WASM pkg/; pre-push
  hook needs it too — `SKIP_PREPUSH=1 git push` for docs/CI-only work; CI is the
  gate of record. `vp` not on PATH here — use `pnpm exec vp` / package scripts.
- Miniflare tests can't read host fixtures — inline strings. Static routes before
  parameterized ones. Email Routing has ONE zone catch-all (why the control-plane
  token index exists — never "simplify" it back).
- osv gate: severity keyed on CVSS >= 7.0; accepted advisories only in root
  osv-scanner.toml (lockfiles via explicit -L); tracked ignores lapse 2026-10-14
  (quick-xml x2, uuid) and will fail the gate then; GHSA-gv7w-rqvm-qjhr is an
  unused ignore — prune when in the file.
- Environment: no `gh` CLI (GitHub tool server instead); git proxy 403s ref
  deletions (branch cleanup is owner-manual); osv-scanner binary not downloadable.
- Keep-both conflict resolution on additive registries (per-firm-schema.ts,
  pii-registry.ts, telemetry events) can SILENTLY INTERLEAVE blocks: git aligns
  on shared trailing lines (createdAt/updatedAt, closing brackets) and splices
  one subsystem's declarations inside the other's. Typecheck catches most but a
  schema-shaped splice can look plausible — after any registry merge, verify each
  subsystem's block is contiguous (grep the export boundaries) before trusting it.
- The advisories above were RESOLVED 2026-08-04 (uuid override; quick-xml capped +
  extended to 2027-02-14 with reachability analysis; the exit is replacing
  office-crypto). The osv line above is kept for the mechanism, not the dates.
- Deploys: Workers Builds production branch is `release`, not `main`.

## Revival procedure (cold start)

1. `git fetch origin` — check out this branch; read this note, `docs/deploy-queue.md`,
   TaskList, and the status artifact (via its URL above; WebFetch to read it).
2. `git ls-remote origin 'refs/heads/claude/*' 'refs/heads/remediate-*'` + list open
   PRs — reconcile against the state snapshot; anything a dead agent left half-done
   is visible as a branch without a PR or a PR without a merge.
3. Re-arm: PR subscriptions for every open PR you own, a send_later check-in if any
   gate is running, and verify the heartbeat trigger is enabled.
4. Continue the task board in order; keep this note and the artifact current.
