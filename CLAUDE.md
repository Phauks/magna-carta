# Magna Carta — CLAUDE.md

Magna Carta is a legal practice-management platform the firm controls — matters, time, trust, billing, costs, conflicts, discovery, custodian, documents & automation, a client portal, payments, and reporting — built on Cloudflare, multi-tenant from day one.

This is the **entry point** for anyone working in this repo: the golden rules and where everything lives. Read it, then follow the links — detail lives in the linked homes, not here.

## Orientation — where everything lives (one home per fact)

Documentation is **segmented and non-duplicative.** Every fact has one authoritative home; everything else links to it. Put new information in its home.

| You need…                                                     | Home                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Why / what — design, rationale, feature map                   | [`docs/Magna-Carta-White-Paper.md`](docs/Magna-Carta-White-Paper.md)                  |
| Decisions + status (ADR register & standard)                  | [`docs/Decision-Log.md`](docs/Decision-Log.md)                                        |
| How to work here + golden rules + this map                    | **this file**                                                                         |
| Code standards (style, UI, testing, security, API, docs)      | [`docs/conventions/`](docs/conventions/)                                              |
| Subsystem design (spec → plan → build)                        | [`docs/specs/`](docs/specs/)                                                          |
| Local rules & gotchas for a code area                         | a `CLAUDE.md` beside that code ([template](docs/conventions/area-claude-template.md)) |
| End-user & admin guides (per feature)                         | [`docs/user/`](docs/user/)                                                            |
| Live execution status (now / next / shipped / backlog)        | [`ROADMAP.md`](ROADMAP.md)                                                            |
| What is blocked on the owner / in build / queued (one screen) | [`docs/now.md`](docs/now.md) — generated; never hand-edited                           |
| What users are told is coming                                 | [`docs/public-roadmap.md`](docs/public-roadmap.md) — generated; never hand-edited     |
| Feature ledger (capability inventory, per-node status)        | [`roadmap.d/`](roadmap.d/) — the source both of those render from                     |
| Per-slice stage status (spec → plan → built → tested)         | [`STATUS.md`](STATUS.md)                                                              |
| Concurrent work in flight (other worktrees/branches)          | [`docs/active-work/`](docs/active-work/) (+ `vp run worktrees`)                       |
| Notable changes                                               | [`CHANGELOG.md`](CHANGELOG.md)                                                        |
| Docs-sync routine & its run reports                           | [`docs/maintenance/`](docs/maintenance/)                                              |
| Recurring & associated costs (subscriptions, usage, one-time) | [`docs/operating-costs.md`](docs/operating-costs.md)                                  |
| Research (trust rules, competitive analysis)                  | [`docs/research/`](docs/research/)                                                    |

**Cross-reference rule:** `§N` is navigation _inside_ the white paper only. From any other file, reference the white paper by **document + topic name** (or a stable **`ADR-NNNN`**), never a section number — they shift on reorganization.

**Developer docs vs. user docs — not duplication.** The white paper / conventions / specs / ADRs serve _builders_; [`docs/user/`](docs/user/) serves _people using the product_. Different facts for different readers (no shared sentences to drift), hard boundary: no internal architecture in user docs, no task walkthroughs in developer docs. `docs/user/` is additive — the only home for user-facing help, which is itself a shipped product feature.

## Stack at a glance

- **Languages:** TypeScript (primary); **Rust** surgically (Tauri shell, Tantivy, a shared doc/discovery core → WASM for web + native for desktop).
- **Frontend:** Svelte 5 / SvelteKit (SPA, `adapter-cloudflare`); Tailwind v4 + the in-house **`@magna-carta/design-system`** (styled directly on headless **Bits UI**); DTCG tokens via Terrazzo; **Lucide icons**.
- **Backend:** Cloudflare **Workers** + **Hono**; REST as **OpenAPI 3.1 code-as-contract** (zod).
- **Data/platform:** per-firm **D1** + control-plane **D1**; per-firm **R2**; **Queues**, **Durable Objects**, **Vectorize**, **KV**; **Containers** (Collabora, Tantivy, OCR, LibreOffice).
- **Auth:** Better Auth (control-plane D1). **Desktop:** Tauri 2 (after web MVP). **Tooling:** **Vite+** (CLI `vp`; manages pnpm + dev/build/pack/test + `vp check` for fmt/lint/typecheck — Oxc) · rustfmt/clippy. **Source control:** GitHub (repos, branch protection, PRs, review). **CI/CD:** **Cloudflare Workers Builds** (`vp run build-all` → `wrangler deploy`), not GitHub Actions. The Workers Builds **production branch is `release`, not `main`** — pushing or merging to `main` builds and deploys nothing; a deploy is a deliberate `git push origin main:release`, and `git log release..main` is the undeployed queue. Runbook: [`docs/conventions/operations.md`](docs/conventions/operations.md).

Architecture detail: the [white paper](docs/Magna-Carta-White-Paper.md) — _Delivery model_, _Authentication & encryption_, _Core domain_.

## Golden rules

Broad principles for how we build — they apply across the work, not just one subsystem.

1. **Reuse before building.** Check for an existing component, utility, or pattern before creating a new one; compose and extend rather than reinvent.
2. **All UI through the design system.** Style only with Tailwind + the `@magna-carta/design-system` components and design tokens — no raw CSS, no off-token values, no direct `bits-ui` imports outside the design-system package (CI rejects all three). Lucide icons; **no emojis** anywhere (UI, docs, commits). (_Design system_; ADR-0076)
3. **Data access through the firm-scoped DAL.** All business data goes through the firm-scoped data-access layer — no query crosses firms; bulk content to R2, never D1. (_Tenancy & data isolation_; ADR-0003)
4. **Standardized error & bug logging.** Report every error/bug through the one standard in-house pipeline; **redact by default** (never log privileged content), correlate by ID, surface a user-facing Error ID, and never use a third-party error SaaS. Standard: [`docs/conventions/error-logging.md`](docs/conventions/error-logging.md). (_Observability & diagnostics_; ADR-0017, ADR-0038)
5. **Keep documentation current.** No feature is done until its docs (developer _and_ user) and [`ROADMAP.md`](ROADMAP.md) + [`CHANGELOG.md`](CHANGELOG.md) are updated — same commit. For the changelog and ADRs this is met by committing a **fragment** (`changelog.d/<slug>.md`, `docs/decisions/pending/<slug>.md`); the rendered `CHANGELOG.md` and the Decision-Log register are build outputs assembled on `main` by `vp run changelog-build` / `vp run decisions-build`, never hand-edited on a branch. Standard: [`documentation.md`](docs/conventions/documentation.md); language: [`documentation-style.md`](docs/conventions/documentation-style.md).
6. **Feature parity.** Web and desktop stay at parity; no platform-exclusive features (desktop only adds optional local accelerations with a server fallback). (_Delivery model_; ADR-0023)
7. **No shell for file operations; Bash is the shell.** Dedicated file tools only — the shell is for git, pnpm, cargo, rustup, and process management. Of the two shells this machine offers, **Bash (Git Bash) is canonical**; reach for PowerShell only for genuinely Windows-native work (process/service management, ACLs). Mixing them is not a style preference: the two take opposite multi-line-string syntax (heredoc vs here-string) and opposite path/redirect idioms, and PowerShell invocations here fail about four times as often as the same work in Bash. Write paths in one canonical form — `C:/dev/magna-carta-worktrees/<branch>`, forward slashes, unquoted — and pass absolute paths rather than prefixing `cd <dir> &&`, so a permission allow-list entry can actually match twice.
8. **Design before code.** White paper → brainstorm → spec ([`docs/specs/`](docs/specs/)) → plan → build; record decisions as ADRs in [`docs/Decision-Log.md`](docs/Decision-Log.md), same commit.
9. **One home per fact.** Follow existing conventions; reference the white paper by topic name or `ADR-NNNN`, never a `§` number.
10. **Measure before optimizing; keep work off the hot path.** No heavy work in a request handler or on the UI main thread — offload to Containers/Queues/Web Workers; stream, don't buffer; no N+1. Optimize against the load-profile harness, not guesses. (_Performance & concurrency model_; ADR-0039)
11. **Implement on the latest — verify library docs first.** Before using or upgrading any library, look up its **current** documentation and build against the latest stable API/patterns (e.g. Svelte 5 **runes**, Tailwind v4, Vite+ `vp`) — never older idioms from memory. Web-search the docs when unsure. Getting it current up front avoids retrofitting the codebase later. (_Development guidelines_)
12. **Fully write out names — no shorthand.** Spell every name out in full across packages, code, and docs: `@magna-carta/identifiers` not `ids`, `@magna-carta/database` not `db`, `@magna-carta/data-access` not `dal`; `newIdentifier()` not `newId()`; "the data-access layer", never "the DAL". Clarity imposed now is cheap; decoding shorthand later is not, and it compounds across the codebase. Only exception: documented storage-encoding suffixes from an accepted spec (e.g. `amount_minor`, `rate_e4`) and universal external terms (`id`, `URL`, `JSON`, `SQL`). Standard: [`docs/conventions/code-style.md`](docs/conventions/code-style.md).
13. **Code explains itself; cite files, not process docs.** Source, tests, config, and consumer-facing strings (e.g. OpenAPI `description`s) carry **no references to process artifacts** — no `ADR-NNNN`, no "design spec" / "spec §N", no white-paper section citation, no "slice 0·N" / "Phase N", no "decided #N" / plan "Task N", no "spike". State the _reasoning_ inline, or point to a concrete file (another module, or a living standard in [`docs/conventions/`](docs/conventions/) **by path**). ADRs, specs, and plans are point-in-time process records that move, renumber, and get superseded; a comment that explains _why_ outlives them. Decisions are still recorded as ADRs (golden rule 8) — the [Decision Log](docs/Decision-Log.md) is their home, never the code. **One exception:** a _forward-looking_ slice/phase reference that names **when** an interim or seam gets replaced, or a feature gets built (e.g. "slice 0·6 swaps in the real email adapter", "built in Phase 2·3") — that states a real schedule, not a process-doc citation, and is allowed. Enforced in CI by a source-scan fitness function (`pnpm run lint:process-refs`). Standard: [`docs/conventions/code-style.md`](docs/conventions/code-style.md).
14. **Memory-safe languages by default — Rust, TypeScript, Svelte.** Build in Rust, TypeScript, and Svelte. A **C/C++ dependency or tool** — including transitive native libraries and C-compiled-to-WASM — is used **only when there is no legitimate Rust/TypeScript alternative**, and even then **only with explicit owner consent**. Memory-unsafe code parsing untrusted, privileged bytes is a confidentiality risk even inside a sandbox, so prefer the memory-safe library even at some cost in performance or format breadth, and record the trade. When an existing or proposed dependency pulls in C/C++, surface it and ask rather than adopting it silently. (e.g. the raster conversion engine uses the pure-Rust `image` crate, not native libvips; where a C engine is genuinely unavoidable — clamd in the malware-scan Container — it is consented, contained in a network-isolated sandbox, and documented.)

**Domain invariants (scoped).** Subsystem-specific correctness rules — the financial & trust ledger rules, and secrets/encryption — are hard but bind only in their area: see [`docs/conventions/invariants.md`](docs/conventions/invariants.md) and the local `CLAUDE.md` of the area you are working in.

## How we work

- **Build in vertical slices:** each feature complete through every layer (schema → firm-scoped data-access layer → API → UI → tests → docs), not horizontal layers — each slice ships working and is perf-tested against the load-profile fixtures as built.
- **Build when in the area:** when a slice is open, include the cheap-from-the-getgo / expensive-to-retrofit parts up front — seams, schema columns, instrumentation. "Build when measured" gates are for heavy machinery only (golden rule 10 governs optimization, not foundations). This includes **build-time performance**: anything that builds repeatedly in CI or the cloud is made fast by default (caching, path-filtering, slow inputs baked at build time) — fast feedback compounds, and a cache is a foundation you add up front, not a measure-first optimization. Home: [`docs/conventions/build-performance.md`](docs/conventions/build-performance.md). (ADR-0078)
- **Implementation:** autonomous and terse; comprehensive fixes over incremental patches. Design and brainstorming stay collaborative.
- **Bootstrap first, then check what changed.** A fresh worktree starts without its generated artefacts (the Rust→WASM output under `packages/{pdf,decryption,email}/src/pkg/` is git-ignored), so anything importing them fails until they exist: run **`vp run bootstrap`** once when you create a worktree — it rebuilds only what is stale and is a no-op otherwise. While working, run **`pnpm check:scoped`** (fmt + lint on the diff, incremental `tsc -b`, and svelte-check/Rust only when you touched them), not the full `pnpm check`. The pre-push hook runs that same scoped gate for fast local feedback; the exhaustive whole-repo gate (full `pnpm check` + `pnpm test`) is the **gate of record in GitHub Actions** (`.github/workflows/gate.yml`), which runs on every pull request and push to `main`. Home: [`docs/conventions/build-performance.md`](docs/conventions/build-performance.md).
- **Read a file immediately before you edit it, and give every file one owner.** Most failed edits are stale-context edits: the file was read long ago, or a second agent rewrote it in between. When work is split across concurrent agents, each file belongs to exactly one of them — overlapping ownership turns a fast parallel pass into a serial repair job.
- **Per-area `CLAUDE.md`:** each code area carries its own (template in [`docs/conventions/`](docs/conventions/)) for local rules and the domain invariants that apply there — keep cross-cutting rules in `docs/conventions/`, not duplicated locally.

### Parallel worktrees & branches

Several worktrees run at once, so streams must stay aware of each other and keep merges cheap.

- **Make your stream visible.** When you start work, add a note at [`docs/active-work/<branch>.md`](docs/active-work/) (scope + the files you expect to touch). Before starting a stream — and **before editing any cross-cutting file** (`CLAUDE.md`, `STATUS.md`, `ROADMAP.md`, the white paper, `docs/conventions/`) — run **`vp run worktrees`** to see what else is in flight and where it overlaps. One note per stream (never a shared list), so the registry never collides.
- **Append-don't-collide on shared files.** CHANGELOG, ADRs, and STATUS go through fragments (`changelog.d/`, `docs/decisions/pending/`, `status.d/`), assembled on `main` — branches never edit `CHANGELOG.md`, the Decision-Log register, or `STATUS.md`/`STATUS.json` directly. For status, edit only your slice's `status.d/<slice>.md` fragment (`vp run status-build` renders the rest).
- **Sync `main` on a cadence.** Long-lived branches merge/rebase `main` regularly, and **always before touching a shared or generated file** — merge cost scales with drift. If `main` is more than a handful of merges ahead (`vp run worktrees` shows the gap), sync before continuing.
- **Worktree lifecycle.** Feature worktrees live at `C:/dev/magna-carta-worktrees/<branch>`; transient agent worktrees under `.claude/worktrees/`. When a branch merges, in one step **remove its worktree, delete the branch, and delete its `docs/active-work/<branch>.md`**. Periodically `git worktree prune` and clear `[gone]` branches. A tracked `post-merge` hook runs `vp run clean` on every merge to `main`, sweeping regenerable build artifacts (`target/`, `.svelte-kit/`, `.wrangler/`, `.vite/`, `dist/`, `build/`, `coverage/`) from worktrees whose branch is merged — and pruning dangling Docker cache — so dead build output never accumulates. The hook is git-ignored-only and never removes a worktree, branch, or `node_modules`. Run **`vp run setup-hooks`** once per clone to activate it; `vp run clean` is also runnable by hand (preview with `node tooling/clean/index.mjs --dry-run`).

## Commands

```
vp install                                                              # deps (vp manages pnpm + Node version)
vp run bootstrap                                                        # FIRST in a new worktree: build the git-ignored Rust->WASM artefacts; rebuilds only what is stale, no-op when current
vp run setup-hooks                                                      # one-time per clone: activate the tracked git hooks (pre-push quality gate + auto-clean on merge to main)
vp dev                                                                  # web SPA dev server only (Vite HMR, no Worker)
vp run worker-dev                                                       # full local app: builds the SPA, then runs wrangler dev (Miniflare: local D1/R2/Queues)
vp run build-all                                                        # build all apps in dependency order
vp run worktrees                                                        # print the active-work registry (concurrent streams + touch-overlaps + drift from main)
vp run public-roadmap-build                                             # re-render docs/public-roadmap.md + docs/now.md from the roadmap.d/ feature ledger (run after flipping a node's status)
pnpm test                                                               # unit + integration (Vitest, single-run; includes the Miniflare worker integration test). Wraps `vp test` with a per-worktree single-flight lock — two runs in one worktree wedge each other at 0% CPU, so a second one is refused. Args pass straight through; filter by PATH, not by test name
pnpm check:scoped                                                       # INNER LOOP: fmt+lint on the diff, incremental tsc -b, svelte-check/Rust only if touched
pnpm fix:scoped                                                         # apply fmt + lint autofixes to that SAME diff (markdown included) — never a bare repo-wide `vp check --fix`. Autofixes known to be wrong here (sort()->toSorted(), `=== false`->`!x`) still WARN but are never applied
pnpm check                                                              # full quality gate (slow, exhaustive): every pass over the whole repo. The gate of record runs it in GitHub Actions (.github/workflows/gate.yml) — run it by hand only when you want the whole-repo answer before a push
pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run        # validate deploy without pushing
cargo test  /  cargo clippy                                             # Rust
```

## Where to look next

**Live status:** [`ROADMAP.md`](ROADMAP.md) · **Changes:** [`CHANGELOG.md`](CHANGELOG.md) · **Phase strategy, roadmap rationale & open research:** the [white paper](docs/Magna-Carta-White-Paper.md).
