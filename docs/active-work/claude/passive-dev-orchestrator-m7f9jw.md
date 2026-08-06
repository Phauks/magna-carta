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

## Position update (2026-08-06 ~23:50 UTC) — campaign 2 nearly closed; Magnus LIVE; owner scope answers banked

One hundred eighteen merged. OWNER TURNS today (all genuine): (1) SUCK IT
rounds — status protocol name. (2) Directives: finish-the-designs (tasks
103-106 created + 93/95/96/97 stand), search/discovery STATS harness (107 —
standardized owner-readable speed report), Magnus BUILD authorized (AI
Gateway seam, opt-in), AI Search design-then-flags + opt-in. (3) Flags:
H1/D3/L3/F1 ratified (#145); Magnus F2 (four working roles)/F3 (per-convo
grants)/F4b ratified — F4b REFRAMED: transcripts are WORK PRODUCT (protected,
deletable, archivable; discoverable like email BUT any search/discovery
surface reaching them needs an EXPLICIT include-or-exclude control — binds
discovery 5·1·2+, recorded #158). (4) Queue-when-time scopes: conflicts BOTH
gaps (112), reporting ALL FOUR surfaces bar-audit-first (113), discovery 5·2
tagging-first (114) — start when current queue drains. (5) Queue-level
question answered: 2 heavy + 2 light is the box optimum; expansion = buy
Actions minutes (recommended) / bigger env / wait Sept 1 — OWNER HAS NOT
CHOSEN; austerity bar stands. MERGED since 108: #149 assets (idx 38), #150
discovery Rust core, #151-153 campaign-2 reviews (43 findings: 7H/17M/19L),
#154 R1 financial fixes (H1 trust attribution — client derived from
matter_party, its one home now in packages/matters/src/matter-party.ts),
#155 AI Search assessment (adopt-partially retrieval-first; instance-per-firm
only shape that scales; filter-disjunction docs CONTRADICTION — test before
walling; matter-dimension R2 metadata = build-now task 110), #156 Magnus
design (NO new port — @magna-carta/inference IS the seam; ADR-0111/0112/0113),
#157 R2 operational fixes (two-signatory bound to real members, idx 39),
#158 flags, #159 MAGNUS SLICE 1 (idx 40; FIFTH permission inventory found:
RESOURCE_BY_PERMISSION_NAMESPACE in conformance.test.ts; JobProgressSockets
deliberately NOT reused — bucket attachment is a signed-URL guard). IN
FLIGHT: R3 automation fixes (final worker run; addDays/sweep-convergence/
DKIM-From; duplicate-From finding DISPROVEN by test; no migration) + billing
3·4·2 trust application (tag 20260806T060000 idx 41 expected; no-double-
credit dedicated test; two-person disposition flagged). Journal head idx 40.
QUEUE: 103 discovery 5·1·2 (F4b include/exclude control), 104 auto-file
wiring, 106 assets 4·3·2/3, 93 catalog 2-4, 95-97, 107 stats, 109/110 AI
Search, 90; THEN owner-scoped 112/113/114. NO 6/7, NO UI. Sept 1 revert
armed. Contention adjudication standard mature: disjoint-sets + isolation
pass + honest disclosure; base-vs-changes stash-testing now standard.

## Position update (2026-08-06 ~04:20 UTC) — OWNER REDIRECT: deepen 0-5 only; UI parked

One hundred eight merged. OWNER TURNS (2026-08-06, genuine): (1) Flag round —
H1/D3/L3/F1 ALL RATIFIED as recommended, B1 by acknowledged silence (recorded
docs/decisions/pending/design-flags-h1-d3-l3-f1-ratified.md, #145). (2)
DIRECTION: "I would be surprised if only 6/7 are next steps. if that is the
case, do not start work on any of those. I feel like we need to further
develop 0-5" — NO phase 6/7 work (portal/payments/exports designs NOT
started); queue re-aimed at 0-5 depth: review campaign 2 over all post-F-173
code (task 94), Notifications delivery design+build (95 — emission points
wired to nothing), 2·6·3 PDF+e-sign tail (96), load-profile gaps custodian+
calendar (97), catalog slices 2-4 (93, H1 unlocked), discovery builds,
billing 3·4·2, auto-file 2, numbering consolidation (90). (3) UI: "not doing
UI until after this trip, so no work on it yet" — FULLY PARKED, no design, no
prep. MERGED since 100: #142 auto-file slice 1 (partial-index find; demotion
reason flagged to slice 2), #143 billing spine (proven-union batch method
born here), #144 calendar (idx 36; matter.created allowlist fix; interleave
trap dodged by rebuild-from-main), #145 ratifications, #146 catalog slice 1
(idx 37; H1-free proven; golden keys 35->37; latent type error outside diff
found by tsc), #147 D3 widening (KEY-SHAPE RULING: id-only, kind segment
redundant — discovery 5·1·1 reconciles the decision record's wording, task
99 carries it). Journal head idx 37 = 20260806T010000. IN FLIGHT: assets
slice 1 (tag 020000, idx 38 expected) + discovery 5·1·1 (tag 030000). Merge-
queue discipline mature: pre-assign tags in dispatch order, second-to-merge
retags, database typecheck FIRST after any merge, generated files re-derived
never hand-merged, structural no-lost-operations diff. Sept 1 revert armed.

## Position update (2026-08-05 ~22:00 UTC) — ONE HUNDRED MERGED

Merge 99 = #138 custodian destruction + Nevada catalog (task 83): two-person
by trigger incl. NULL-requester case; execution needs a COMMITTED approval;
intrinsic-value refusal closed at THREE layers (the agent found the ordinary
movement path accepted a destroyed movement — a reachable override, fixed);
NV-1..5 verbatim incl. the verified NEGATIVE (no lifetime deposit); C4 proven
at 8/9; C6 advisory via a new CloseAdvisory hook that structurally cannot
block (own MatterCloseAck component); migration idx 32 = 20260805T180000.
Merge 100 = #140 composite extraction (task 86): born-digital PDFs now extract
natively per page with native/ocr provenance on the RESULT (no schema);
recognition gate moved into pdf-core so extractor and recognizer cannot
disagree; re-extraction rides the existing daily cron; three typography bugs
caught by genuine fixtures (inferred spaces, baseline grouping, per-line gap
scaling). NO migration, NO contract move. IN FINAL REVIEW: #139 trust
reconciliation (task 79 — four append-only tables, entry-keyed matching
because earned-fee transfers write NO movement row [the load-bearing
deviation], honest reds naming the leg, frozen closes, superseded-recon
matches ignored by the outstanding read, T9/T10/T11 recommended defaults,
profile v10; second-to-merge instruction SENT: retag idx 33 + regen contract
+ re-run affected). MERGE-QUEUE DISCIPLINE proven twice today: tag order
decides merge order (custodian 180000 before recon 200000); contention flakes
on shared 4 cores are adjudicated by disjoint-sets + isolation-pass evidence
(accepted #138, #140 on that standard — import time 3.5x wall documents the
contention; the box also rebooted once mid-run). After #139: dispatch task 73
exports fix + first flag-free build slices (check merged plans: catalog slice
1 H1-free?, auto-file slice 1 on F1 staged default, billing slice 1). Owner
ledger: task 85, 50 flags (H1, D3-deadline, B1, L3, F1 first). Austerity
reverts Sept 1 (trigger armed).

## Position update (2026-08-05 ~17:40 UTC) — OWNER SESSION: decisions, three new subsystem designs, lint lever landed

Ninety-three merged. OWNER DECISIONS (genuine turns, ~15:30-16:10Z, recorded in
docs/decisions/pending/ via #126): (1) Actions minutes reset START OF NEXT
MONTH — one-shot trigger trig_01CyD83cWkUfdtGdPxz5vmob armed 2026-09-01 12:00Z
fires the austerity revert into this session (task 61 updated). (2) T12
RATIFIED: hard close block kept, no override. (3) TWO-PERSON DISBURSEMENT
AUTHORIZATION: BUILD NOW (task 75, in flight — pending-request state, approver
differs enforced in DB, ceiling re-checked at approval, single-manager firms
recorded-as-such; migration idx 31 = 20260805T170000 expected). (4) Next work
ALL FOUR ratified (recon/billing/auto-file/discovery, tasks 79-82) PLUS three
new asks: merge-field catalog SYSTEM design (dedicated agent — DELIVERED,
#127), matter ASSETS (properties/APN/accounts/vehicles/firearms, "estates and
asset logging super easy" — DELIVERED, #130), case CALENDAR (litigation +
case events — DELIVERED, #131). (5) Custodian C4-C11 ALL RATIFIED as
recommended (#126; destruction workflow build unblocked = task 83); C8 =
design-first, NEVADA first jurisdiction — research DELIVERED+MERGED (#128:
NRS 136.050(1) 30-day delivery duty verbatim; no lifetime deposit procedure
(affirmatively established — uniform-act web results are a TRAP, documented);
lodging is county rule; NRS 133.300-133.340 e-will qualified-custodian role =
owner decision, flagged). ALSO MERGED: #129 protected-value merge binding
(Directory identifiers via the ONE decrypt path, audit reused, paralegal
refusal = declared absence, plaintext proven absent from every row+log; scope
honestly pivoted from "custom fields" — custom_field has NO protected model,
future owner decision); #132 lint fan-out sink deferral (worker = 75.6%
type-program weight; PR-tier defers sinks-as-dependents only, union-coverage
fitness lint:affected-scope in governance, -68% lint minutes per merged
change; app.ts hub named as the real refactor target). OWNER-ASK LEDGER now
headlined by task 85: design flags H1-H6 (catalog; H1 gates 3/7 slices),
A1-A5 (assets), L1-L7 (calendar; L3 = never compute deadlines from court
rules without verified catalog). IN FLIGHT: two-person auth build (75),
billing design (80), auto-file rules design (81). QUEUE: trust recon build
(79), discovery design (82), custodian destruction+Nevada encoding (83),
stale email-filing export (73), task 65 folds into Sept-1 revert. NEW GOTCHA:
PII registry is a literal inventory — migration-bearing briefs MUST run
data-access suite (#118 missed it, #125 repaired).

## Position update (2026-08-05 ~14:45 UTC) — gate integrity restored; custodian counts + role fields

Eighty-two merged. HEADLINE (#119, task 68 CLOSED): the gate of record was
collecting 284 OF 719 test files — path filters match PER PROJECT against
project-root-relative paths, so relative ancestor paths (`packages`,
`tooling`) matched nothing and exited 0; apps/sign-worker was never listed
anywhere. All 435 un-run files pass (un-run coverage, not hidden breakage).
Fix: absolute "$PWD/..." paths + new lint:test-collection (floor 647, union
= registry, jobs disjoint, invocations held verbatim vs gate.yml). TRAP also
found: two negated --project patterns CANCEL (OR-ed regexes) — never use
multiple negations. Verify live on first post-reset run (task 61). Also
merged: #117 undeclared-body contract fix (task 66); #118 custodian stocktake
(task 69 — observe-only at four depths, proposals never actions, migration
idx 29 = 20260805T150000, C4-C11/C8 untouched); #120 status-fragment repair;
#121 directory role sources (task 70 — opposingParty/opposingCounsel/guardian/
witness via one already-issued party read, ambiguity = named reason on the new
absenceReasons channel, never a silent pick; note: bare-key {{#if role.x}}
rewrites to has() and answers no on ambiguity — documented, deliberate).
NEW GOTCHAS: (a) `vp` NOT on PATH in fresh worktrees — bare `vp run bootstrap`
exits 0 building nothing; always `pnpm exec vp run bootstrap` + verify pkg/
dirs exist. (b) Killing a `pnpm test` wrapper ORPHANS the vite-plus-test cli.js
process — orphans starve the box (~3x slower suites); kill the cli.js PID.
(c) `pnpm --filter @magna-carta/web test` silently no-ops (no test script) —
use `node_modules/.bin/vp test run --project=web`. (d) Worker firm-scoped rate
bucket is 100/60s — big new route-test blocks need their own seeded firm.
Building: email add-in client API (task 71). Queue: task 63 lint-fanout design,
3·2·3 trust (T-flag check first), 2·6 protected-value binding, custodian
receipts (blocked on matter-routed assembly) / portal visibility (blocked on
portal grant model). Owner ledger unchanged; Actions reset date still top ask.

## Position update (2026-08-05 ~12:15 UTC) — trust movements + safe tooling landed

Seventy-six merged. #114 tooling pair (task 54 CLOSED): fix:scoped now drives
formatter and lint autofix separately with unsafe rules allowed off in the FIX
PASS ONLY (tooling/check-scoped/unsafe-autofix-rules.mjs — the two known-bad
rewrites still warn everywhere, never auto-apply); `pnpm test` is now a
per-worktree single-flight guard (atomic wx lock, dead-holder + 90-min stale
reclaim, MAGNA_CARTA_ALLOW_CONCURRENT_TESTS=1 override) — the wedge did NOT
reproduce on this container, guard makes it moot. #115 trust 3·2·2 (task 67
CLOSED): deposits (gross, lazy leaf + floor + first posting ONE batch),
disbursements (ceiling = available, authorizer required), matter-to-matter
transfers (bank-free same-client shape — NO phantom bank lines; guard admits
exactly one bank-free shape, >=2 distinct matter leaves); append-only
trust_movement client-ledger record with shape CHECKs; ledger pendingAccounts
with stored-row-wins; migration idx 28 = 20260805T140000, snapshot 0028, no
collision. MONEY_NAMESPACES gains trust; rule rebound to MUTATING methods
(a GET has no write to deduplicate). Recommended-defaults shipped for owner:
permit-all disbursement-method policy (T7 territory; method recorded from
movement one) and authorizer = authenticated submitter (columns pre-split for
two-person workflow). NEW gate-integrity finding (task 68): positional path
filters REPLACE vitest collection rather than narrowing it (41/327 vs 666/6313)
— gate.yml test-node may under-collect; audit + floor assertion, verify
post-reset. tsconfig-refs main breakage repaired by #115's regeneration; 0027
snapshot format drift joins 0022 in task 65. Swept ~29 stale active-work notes
(this commit). Dispatched next: task 66 contract fix + custodian 4·2·4
stocktake. Then: directory role sources, add-in client API, 3·2·3+ per
analysis.

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
