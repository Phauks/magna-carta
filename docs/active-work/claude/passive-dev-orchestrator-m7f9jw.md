---
branch: claude/passive-dev-orchestrator-m7f9jw
worktree: (remote session — orchestrator)
area: cross-stream orchestration — status truth, roadmap, delegated slices, review-fix campaign
status: building
touches: docs/active-work/ (sweeps), docs/deploy-queue.md, status.d/ (merged-stream repairs), .claude/settings.json, delegated agent branches (each with its own note)
---

# Orchestrator revival document

Long-lived orchestration stream. This note is the **durable memory**: everything a
fresh context or container needs to resume at full capacity.

**How to write to this file.** Each section below carries a write rule, and the rules
are the point — this document became a 743-line blob because there was no rule about
where anything went, so every update appended another full restatement of the world.
Sections 1, 3 and 4 change rarely. Section 2 is **overwritten**, never appended —
only the current position matters, and git already keeps the old ones. Section 5 is
mutated as items resolve. Section 6 grows, but curated. Section 7 gets **one line**
per milestone, never a paragraph. Detail belongs in the PR and the commit, not here.

Do not restate the task board or ROADMAP here. They are the home for the queue
(golden rule 9); this note points at them.

---

## 1. Cold start — read this section first

1. `git fetch origin`, check out this branch, read this note top to bottom.
2. Read `docs/deploy-queue.md`, run `TaskList`, and fetch the status artifact
   (section 4 has the URL).
3. Reconcile reality against section 2: list open PRs, and
   `git ls-remote origin 'refs/heads/claude/*' 'refs/heads/remediate-*'`.
   Anything a dead agent left half-done shows up as a branch with no PR, or a PR
   with no merge.
4. Re-arm: PR subscriptions for every open PR you own, a `send_later` check-in if a
   gate is running, and confirm the heartbeat trigger's state matches section 4.
5. Work **section 8**, the execution order — it says what to do next and why. The task
   board holds the items themselves. Update section 2 and the artifact at each milestone.

---

## 2. Current state — OVERWRITE THIS SECTION, never append

_Last updated 2026-08-11, ~03:00 UTC._

- **Merged:** 149 pull requests. Head PR is **#194**.
- **Open PRs, both awaiting the owner:**
  - **#192** status page — upstream severity scoping plus the 90-day bar's
    accessibility. Verified and mergeable; carries three owner decisions (polling
    host `www` vs `new`, the empty-store false green, per-tick vs run-length
    screen-reader announcement). Public UI surface, so it waits.
  - **#186** `docs-sync/2026-08-10` — propose-only by its own skill, six action
    items, base six merges behind, and ONE modify/delete conflict caused by #193
    (it reformatted a fragment this branch deletes). Resolution is to accept the
    deletion; commented on the PR.
- **CI:** still dead. Root jobs get no runners, all downstream skip. The austerity
  merge bar (section 3) applies.
- **In flight:** nothing.
- **Main's own gates were both red and are now green.** #193 fixed the format gate
  (six files failing on main itself) and #194 fixed typecheck (thirteen ES2023
  call sites against an ES2022 `lib` pin). Both had the same shape: a branch
  inherited a red gate regardless of its own diff. Worth re-checking periodically —
  `pnpm exec vp fmt --check` and `pnpm exec vp run typecheck` answer it in minutes.
- **Journal gap:** section 7 covers through #194 at the summary level. Per-PR detail
  for #183–#191 was never written; reconstruct from git if it is ever needed.

---

## 3. Mandate — owner decisions only; do not edit from inference

Recorded in-session 2026-08-04 unless dated otherwise.

- **Full-program authorization** — any backend slice, any fix, any phase 0–7.
  (Widened 2026-08-07; the original text restricted phases.)
- **UI surfaces are deferred to the owner.** One standing exception: the **sign-in
  surface** was opened 2026-08-07. The rest of the UI stays parked.
- **Production deploys never.** `git push origin main:release` is forbidden and a
  deny rule enforces it. Pending activations accumulate in `docs/deploy-queue.md`.
- **Merges** require a green gate plus a passed review, merged explicitly through the
  GitHub API. Repo auto-merge is not relied on.
  - **Austerity bar** (active whenever CI is dead): full local suites plus an
    adversarial review substitute for the gate. This bar has caught three money bugs
    pre-merge that no test caught — keep it honest, it is not a formality.
- **Invariant-heavy designs** — trust accounting, crypto and compliance calls such as
  protected-column changes — get analysis plus a written flag for owner review. Never
  a unilateral build.
- **Golden-rule-14 consent granted** for the LibreOffice conversion engine (C++ in a
  network-isolated Container, on the Collabora precedent).
- **Standing "dream" directive** — continually look for improvements and expanded
  functionality, confirm tools are genuinely useful, capture ideas in the status
  artifact's ideas ledger, promote mature ones to ROADMAP's interest list or a spec.
- Build modularly; spec-first for new slices (golden rule 8); no emojis; no
  process-artifact references in code.

### Cost discipline (added 2026-08-08 after a usage incident)

Half a week's model budget went in 24 hours, unnoticed until the owner raised it.
Four structural causes, all still live if unwatched: universal adversarial review on
every PR, transcript-replaying agent resumes, a high heartbeat cadence, and a high
merge rate. **Watch burn actively and raise it before the owner has to.** The
heartbeat now runs at a 3-hour cadence rather than hourly.

---

## 4. Standing infrastructure

- **Status artifact** (owner-visible log; refresh at each milestone):
  https://claude.ai/code/artifact/494243b6-b656-47bf-be52-25e1b33f68e3
  Republish the scratchpad file `orchestrator-status.html`. If the scratchpad is gone
  after a restart, rebuild the page from this note plus git history and republish
  with the `url` parameter to keep the link stable.
- **Sign-in mockup artifact:** https://claude.ai/code/artifact/5293058a-000e-4662-bdfa-5c9992259f57
  (scratchpad `sign-in-mockup.html`). **I publish; agents never do.**
- **Background lab artifact:** https://claude.ai/code/artifact/1830af71-7175-4122-95f2-531c7467154e
- **Heartbeat routine** `trig_01Kc6QhpUarReG4qmirNxbkc` — carries the full standing
  instructions and revives this session after usage gaps. 3-hour cadence.
- **Permission allowlist** committed in `.claude/settings.json` on this branch:
  git/pnpm/node/cargo, both tool servers, file and agent tools; deny guards on deploy
  paths and force-pushes to main.
- **Healthy weekly routines:** docs-sync (Mon 14:05 UTC), a second docs-sync
  (Mon 13:03), Cloudflare blog monitor (daily 14:00, reports not persisted),
  dependency updates (Mon 14:30).
- **Austerity revert checklist** is armed for Sept 1 — trigger
  `trig_01CyD83cWkUfdtGdPxz5vmob`, and PR #171's fail-fast changes are marked to
  revert with it.

---

## 5. Open with the owner — awaiting a decision; delete each when answered

- **Trust:** whether one person should be able to dismantle the two-person control.
  A single seeded attorney can relax the policy to `off` and then act alone, audited.
- **Trust:** matter-to-matter reallocations sit outside the authorization policy.
  Nothing leaves trust, so this is a reporting concern rather than a money one.
- **Trust:** the threshold posture's structuring limitation — two at-threshold
  requests bypass one above-threshold rule. Stated honestly in the ADR and the admin
  guide; an aggregation guard is future work.
- **Trust:** Nevada attorney review of the jurisdiction corpus, and the T3 bank-charge
  rule text. The corpus ships marked NOT-VERIFIED until this happens.
- **Escheat (T16):** research returned and awaits the owner before anything is
  encoded. Finding: trust funds do **not** escheat.
- **AI Search:** the live fenced-account run needs Cloudflare credentials.
- **Infrastructure the owner must do:** install the Renovate app; optionally enable a
  merge queue; delete stale remote branches (the git proxy 403s ref deletions, so
  branch cleanup is manual); the bot self-merge setting.
- **Actions minutes are exhausted, and it is costing more than the gate.** Every run
  since **2026-08-07T08:08Z** dies at runner assignment. That takes `assemble-docs`
  down with the gate, so committed fragments stop folding: by 2026-08-12 roughly a
  hundred `changelog.d/` fragments had piled up unrendered. Restoring the budget
  restores both; until then a docs-sync pass is the only thing folding them.
- **Build stamp:** "PST" is hardcoded, but August in Los Angeles is PDT. Owner's call
  whether the label should track the real offset.

---

## 6. Hard-won knowledge — each of these cost real time; do not relearn them

Append here, grouped. Keep entries to the mechanism, not the incident.

### Migrations and schema

- Control-plane migrations are generated (drizzle-kit plus the timestamp script) and
  need their map entry in `control-plane-migrations.ts`. Per-firm migrations need
  hand-registration in `apps/worker/src/per-firm-migrations.ts`.
- Per-firm journal conflicts: keep both sides and renumber `idx` so it stays dense and
  monotonic. drizzle-kit diffs against the tracked baseline — hand-extract only the
  new DDL. Generated snapshots need `oxfmt`.
- Snapshots form a `prevId` chain. A refresh that re-chains to the wrong parent is
  invisible without the chain fitness check added in #180 — trust the check, not the
  regeneration script.
- drizzle-kit `generate` treats a column rename inside an **unmerged** migration as
  no-change when run non-interactively: `check-snapshots` reports current while the
  snapshot still holds the old name. Fix by deleting the new snapshot and
  regenerating from the previous baseline.
- Partial indexes **are** expressible in the drizzle schema — the repo does it about
  twenty times. Any comment claiming otherwise is wrong (one such comment shipped).
- The per-firm database is a **Durable Object**, not D1. Design accordingly.

### Registries and merges

- **Repo-wide registry scans live in the package that OWNS the registry, not in the
  violator.** Per-package runs therefore cannot structurally catch them. **Ten known**,
  and the count has risen every time somebody went looking — treat the list as a floor,
  not an inventory, and grep for source-scanning fitness tests before claiming a slice
  is done:
  1. five permission inventories (one is `RESOURCE_BY_PERMISSION_NAMESPACE` in
     `conformance.test.ts`, which is easy to miss)
  2. the conformance not-vacuous operation list — update it when adding a route
  3. the telemetry metric catalog — a metric missing from it is **silently dropped**,
     so a subsystem ships with its observability going nowhere
  4. `packages/data-access/src/pii-registry.ts` — its coverage test forces every table
     to be classified
  5. the problem-type registry inventory in `test/contracts/problem.test.ts`
  6. the object-dimension source scan in `apps/worker` — fails any new R2 write path
     that omits the dimension stamp
- Keep-both conflict resolution on additive registries (`per-firm-schema.ts`,
  `pii-registry.ts`, telemetry events) can **silently interleave** blocks: git aligns
  on shared trailing lines — `createdAt`/`updatedAt`, closing brackets — and splices
  one subsystem's declarations inside another's. Typecheck catches most, but a
  schema-shaped splice can look plausible. After any registry merge, verify each
  subsystem's block is contiguous before trusting it.
- Generated files — `openapi.json`, the api-client — are **re-derived, never
  hand-merged**. A 422 conflict on them means re-emit.
- Resolve merge conflicts by hunk, never by whole file.
- `status.d` slot numbers collide across parallel branches; move to the next free one.
- Deleting a `docs/active-work` note requires flipping its `status.d` fragment to
  `branch: main` with an empty `active-work:` in the **same** commit (`lint:status`).

### Build, tooling and tests

- Fresh worktrees need `vp run bootstrap` before anything that imports the WASM
  `pkg/` output. The pre-push hook needs it too — `SKIP_PREPUSH=1 git push` for
  docs-only or CI-only work.
- `vp` is not on PATH here. Use `pnpm exec vp` or the package scripts.
- Never run `vp check --fix` blind over worker or ES2022 packages: `.sort()` becomes
  `.toSorted()` and breaks them. Use the diff-scoped `pnpm fix:scoped`.
- pnpm overrides go **only** in `pnpm-workspace.yaml`. In `package.json` they
  silently break the vitest alias chain ("Vitest failed to find the runner"). Plain
  `pnpm install`, never `--no-frozen-lockfile`.
- Two concurrent full-suite runs on this box starve each other. Per-package plus CI
  is the honest fallback.
- **Test-pool live queue consumers race test bodies.** This was the root cause of both
  historical full-suite flakes. The product verdict machines are correct and
  deliberately untouched — overwritable failed/deferred _is_ the redelivery design.
- Miniflare tests cannot read host fixtures — inline the strings. Register static
  routes before parameterized ones.
- Contention flakes on shared cores are adjudicated by disjoint-sets plus an
  isolation pass plus honest disclosure. Stash-to-base testing is the standard.
- Mockup HTML gets headless-Chromium verification before every publish
  (`verify-mock.mjs` in the scratchpad; playwright-core under
  `node_modules/.pnpm/playwright-core@1.60.0/`, chromium at `/opt/pw-browsers/chromium`).
  **Verify what the host actually renders.** Mermaid is _not_ bundled in the mockup —
  the artifact host renders it — so a local probe measures a `<pre>` and every
  assertion about diagram geometry or node clicks passes against the wrong element.
  Two features shipped "verified" and broken this way.
- Batch text-edits use assert-replacements plus post-write marker checks. Two silent
  failures happened without them.

### CI, security, environment

- Jobs failing at runner assignment — `runner_id 0`, about 3 seconds, **no logs** —
  means the budget is exhausted, not that the code is broken. A real gate job produces
  logs. Probe a **fresh** run before diagnosing; a stale run tells you nothing.
  `get_job_logs` returns HTTP 404 for these, which reads like a tool fault and is not;
  the tell is `runner_name: ""` in `list_workflow_jobs`.
- The exhausted budget silently stops `assemble-docs` too, so `changelog.d/`,
  `docs/decisions/pending/`, and `status.d/` fragments accumulate unrendered with
  nothing announcing it. Check the newest `docs/maintenance/reports/` date against
  `main` before assuming the trackers are current.
- Workers Builds' production branch is `release`, not `main`.
- osv gate: severity keys on CVSS >= 7.0; accepted advisories live only in the root
  `osv-scanner.toml` (lockfiles via explicit `-L`). Kept for the mechanism, not the
  dates — the 2026-10-14 advisories were resolved 2026-08-04.
- Email Routing has **one** zone catch-all. That is why the control-plane token index
  exists; never "simplify" it away.
- No `gh` CLI here — use the GitHub tool server. The git proxy 403s ref deletions.
  The osv-scanner binary is not downloadable.
- Real hostnames: `magnacarta.esq` (apex, plus api./app./portal./firm./files./edit./
  status./in./dmarc.), `magnacartausercontent.com` for user content on a separate
  origin, `magna-carta.com` for marketing.

### Working with subagents

- A subagent does **not** get resumed by its own background tasks. Arming a Monitor or
  a background waiter and stopping burns the whole budget for nothing — one agent lost
  293k tokens this way. Tell them explicitly not to.
- **A `pgrep`-based wait loop matches itself and never exits.** `until ! pgrep -f "vp
test"; do sleep 20; done` polls forever, because the waiter's own command line
  contains the pattern. Two agents have left these behind; each orphan then fires a
  task notification every time the harness reaps one, and every notification costs a
  turn in the parent session. Find them with `ps -eo pid,args | grep 'until ! pgrep'`
  and kill the shell plus its `sleep` children. Better: do not poll for a command's
  completion at all — run it in the foreground, or background it and read the exit
  code from a file it writes on the way out.
- Give every file exactly one owner. Overlapping ownership turns a fast parallel pass
  into a serial repair job.
- Remove each agent's worktree at merge; the disk filled once.

---

## 7. Milestone log — one line each, newest first

Detail lives in the PR and the commit. Do not write paragraphs here.

| Date (UTC)      | Merged | What landed                                                                                                                                                                                                                                                 |
| --------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 08-11           | 149    | #193 formatted the six files failing the format gate on main; #194 raised the TypeScript `lib` to ES2023, fixing thirteen call sites that the repo's own `.sort()` autofix had written against an ES2022 pin. Both were main-is-red fixes, not feature work |
| 08-10           | 147    | #187 calendar slice 2 (fork guard: partial indexes were missing from the drizzle schema behind a false comment), #188 translation design, #189 trust authority design, #190 Kitesurf assessment, #191 self-serve tier + free tier design                    |
| 08-08           | 142    | Owner returned; translation services researched. Usage incident: work paused, heartbeat disabled, later restored at 3 hours                                                                                                                                 |
| 08-07 ~14:10    | 139    | #179 calendar design, #180 test-race pair — worker suite 214 files / 1569 tests green under parallelism for the first time, #181 escheat research, #182 catalog follow-ups                                                                                  |
| 08-07 ~12:50    | 135    | #177 catalog slices 2–4, #178 trust authorization policy — **review reproduced a money bug pre-merge** (lone-manager exception borrowable by a `billing:apply` clerk)                                                                                       |
| 08-07 ~10:30    | 133    | #166 auto-file wiring, #174 Nevada corpus, #176 AI Search wall experiment, #175 notifications delivery. CI budget exhausted; austerity bar back                                                                                                             |
| 08-07 ~07:00    | 129    | Merge train: #167 discovery 5·1·2, **#173 sign-in — first UI in production code**, #168 R2 matter dimension, #169 docket record, #171 CI fail-fast                                                                                                          |
| 08-07 ~05:50    | 124    | Owner mega-session: all 92 docket questions answered (9 overrides became tasks 119–128), $5 Actions budget, UI opened for sign-in only, main verifiably green                                                                                               |
| 08-07 ~00:20    | 123    | #164 assets 4·3·2/3, #165 R3 — **review campaign 2 closed 43/43**                                                                                                                                                                                           |
| 08-06 ~22:40    | 121    | #161 billing trust application closed T4, completing the trust arc; #163 AI Search design (retrieval-only, opt-in, derived feed)                                                                                                                            |
| 08-06 (earlier) | 118    | #159 Magnus slice 1 live; #154 R1 financial fixes; #156 Magnus design; F4b reframed — transcripts are work product                                                                                                                                          |
| 08-06 ~04:20    | 108    | Owner redirect: no phase 6/7, deepen 0–5 only; UI fully parked. #142 auto-file, #143 billing spine, #144 calendar, #146 catalog slice 1, #147 D3 widening                                                                                                   |
| 08-05 ~22:00    | 100    | #138 custodian destruction with Nevada catalog, #140 composite extraction (born-digital PDFs extracted natively)                                                                                                                                            |
| 08-05 ~17:40    | 93     | Owner session: three new subsystem designs, lint lever landed                                                                                                                                                                                               |
| 08-05           | 60–90  | Trust foundation, trust movements, gate integrity restored, custodian counts, safe diff-scoped tooling                                                                                                                                                      |
| 08-04           | 14     | Session start. Whole inherited backlog cleared, CI cost package, dependency refresh, fix batches B1–B10 triaged and begun                                                                                                                                   |

---

## 8. Execution order — the forward queue

_Owner-approved 2026-08-11._ Work this top to bottom. It holds **order and trigger
conditions only**; the task board holds the items, so an entry here is a label, a next
step, and what blocks it — never a restatement. Reorder when priorities change; delete
an entry when its task closes. UI work is tracked separately and is owner-driven.

### Tier 1 — finish the money subsystem

The largest unstarted owner-directed work, in the area where a quiet bug is worst. Trust
and billing share files, so these run **one at a time**, not in parallel.

1. **Task 144 — authority-based trust authorization.** Design merged in #189. Authority
   is a property of the person: whoever holds it acts alone, whoever lacks it raises a
   request. Must reconcile with the two-person default (#137) and the per-firm policy
   (#178) already shipped.
2. **Task 146 — bank-charge carve-out, wired narrowly.** The one firm-funds-in-trust
   exception. Nevada RPC 1.15(b) text came back verbatim in #174 and is deliberately not
   yet wired. _Blocked by 144_ — same files.
3. **Task 145 — unclaimed-funds workflow.** Escheat research (#181) settled the law:
   Nevada trust funds do **not** escheat; the duty is NRPC 1.15(f)'s five-year permissive
   remittance to the Clients' Security Fund. Owner requires **manual confirmation on any
   money movement**. _Blocked by 144._
4. **Task 143 — credit-note slice.** Carries the contingency shrunk-basis residual the
   #185 review found. Independent of the three above.

### Tier 2 — close the half-built subsystems

Functional holes, not polish. Each is a subsystem that cannot complete its own job.

5. **Task 96 — document automation 2·6·3 tail.** Assembly works; producing a final PDF
   and handing it to e-sign does not. The subsystem cannot finish a document.
6. **Discovery 5·2·2 and 5·2·4 — privilege claims, logs, productions.** #195 is
   designation-as-tag only; the privilege machinery that makes a production defensible is
   unbuilt. _Blocked by #195 merging._ Needs a task.
7. **Task 117 — AI Search slice 1.** _Blocked on the owner_: the fenced live run needs
   Cloudflare credentials. The non-retrieval halves may proceed.

### Tier 3 — the designs the owner scoped

8. **Task 112 — conflicts 4·1 deepening**, both gaps (trigger coverage and search depth).
9. **Task 113 — financial reporting surface**, all four, bar-audit pack first.

### Tier 4 — health debt

10. **Task 150 — Turnstile.** A runbook item, not shipped code, and four merged designs
    assume it exists.
11. **Task 97 — load-profile gaps**, custodian and calendar. The convention says every
    slice is perf-tested as built; these shipped without.
12. **Task 90 — numbering consolidation** onto `@magna-carta/sequence-numbering`.
13. **Task 61 — revert CI austerity.** _Trigger: Actions has runners again._ Re-check
    `vp fmt --check` and `vp run typecheck` as part of it — both rotted unnoticed under
    austerity precisely because nothing ran them.
14. **Task 45 — condense the schema to a new baseline.** Owner-timed, pre-beta.

### Parked by owner decision

- **Visual regression.** 2026-08-11: _"I don't really care about visual-regression. Until
  we have a product for end-users, that seems like we can revert away from that."_ The
  harness has never had baselines (Docker was unavailable when it was built), so this
  parks infrastructure with zero coverage rather than losing anything. Do not invest.
  Revisit when there are end users. The code is left in place; removal is available on
  the owner's word.

### Waiting on an owner decision before it can be ordered

- **Does the phase 6/7 hold still stand?** Client portal, payments, integrations and
  exports are untouched under the 2026-08-06 directive to deepen 0–5 instead. That
  deepening has now largely happened.
- **The review ledger reads 59 of 173 findings re-verified**, while ROADMAP's `Now`
  section calls the fix campaign "essentially clear". One of the two is wrong.
