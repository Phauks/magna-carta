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

## State snapshot (2026-08-04 ~07:45 UTC — verify against live PRs/branches on revival)

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
