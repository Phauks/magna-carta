# Magna Carta — CLAUDE.md

Magna Carta is a legal practice-management platform the firm controls — matters, time, trust, billing, costs, conflicts, discovery, safe custody, documents & automation, a client portal, payments, and reporting — built on Cloudflare, multi-tenant from day one.

This is the **entry point** for anyone working in this repo: the golden rules and where everything lives. Read it, then follow the links — detail lives in the linked homes, not here.

## Orientation — where everything lives (one home per fact)

Documentation is **segmented and non-duplicative.** Every fact has one authoritative home; everything else links to it. Put new information in its home.

| You need…                                                | Home                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Why / what — design, rationale, feature map              | [`docs/Magna-Carta-White-Paper.md`](docs/Magna-Carta-White-Paper.md)                  |
| Decisions + status (ADR register & standard)             | [`docs/Decision-Log.md`](docs/Decision-Log.md)                                        |
| How to work here + golden rules + this map               | **this file**                                                                         |
| Code standards (style, UI, testing, security, API, docs) | [`docs/conventions/`](docs/conventions/)                                              |
| Subsystem design (spec → plan → build)                   | [`docs/specs/`](docs/specs/)                                                          |
| Local rules & gotchas for a code area                    | a `CLAUDE.md` beside that code ([template](docs/conventions/area-claude-template.md)) |
| End-user & admin guides (per feature)                    | [`docs/user/`](docs/user/)                                                            |
| Live execution status (now / next / shipped / backlog)   | [`ROADMAP.md`](ROADMAP.md)                                                            |
| Per-slice stage status (spec → plan → built → tested)    | [`STATUS.md`](STATUS.md)                                                              |
| Notable changes                                          | [`CHANGELOG.md`](CHANGELOG.md)                                                        |
| Recurring & associated costs (subscriptions, usage, one-time) | [`docs/operating-costs.md`](docs/operating-costs.md)                            |
| Research (trust rules, competitive analysis)             | [`docs/research/`](docs/research/)                                                    |

**Cross-reference rule:** `§N` is navigation _inside_ the white paper only. From any other file, reference the white paper by **document + topic name** (or a stable **`ADR-NNNN`**), never a section number — they shift on reorganization.

**Developer docs vs. user docs — not duplication.** The white paper / conventions / specs / ADRs serve _builders_; [`docs/user/`](docs/user/) serves _people using the product_. Different facts for different readers (no shared sentences to drift), hard boundary: no internal architecture in user docs, no task walkthroughs in developer docs. `docs/user/` is additive — the only home for user-facing help, which is itself a shipped product feature.

## Stack at a glance

- **Languages:** TypeScript (primary); **Rust** surgically (Tauri shell, Tantivy, a shared doc/discovery core → WASM for web + native for desktop).
- **Frontend:** Svelte 5 / SvelteKit (SPA, `adapter-cloudflare`); Tailwind v4 + the in-house **`@magna-carta/design-system`** (styled directly on headless **Bits UI**); DTCG tokens via Terrazzo; **Lucide icons**.
- **Backend:** Cloudflare **Workers** + **Hono**; REST as **OpenAPI 3.1 code-as-contract** (zod).
- **Data/platform:** per-firm **D1** + control-plane **D1**; per-firm **R2**; **Queues**, **Durable Objects**, **Vectorize**, **KV**; **Containers** (Collabora, Tantivy, OCR, LibreOffice).
- **Auth:** Better Auth (control-plane D1). **Desktop:** Tauri 2 (after web MVP). **Tooling:** **Vite+** (CLI `vp`; manages pnpm + dev/build/pack/test + `vp check` for fmt/lint/typecheck — Oxc) · rustfmt/clippy. **Source control:** GitHub + GitHub Actions (CI → Cloudflare via Wrangler).

Architecture detail: the [white paper](docs/Magna-Carta-White-Paper.md) — _Delivery model_, _Authentication & encryption_, _Core domain_.

## Golden rules

Broad principles for how we build — they apply across the work, not just one subsystem.

1. **Reuse before building.** Check for an existing component, utility, or pattern before creating a new one; compose and extend rather than reinvent.
2. **All UI through the design system.** Style only with Tailwind + the `@magna-carta/design-system` components and design tokens — no raw CSS, no off-token values, no direct `bits-ui` imports outside the design-system package (CI rejects all three). Lucide icons; **no emojis** anywhere (UI, docs, commits). (_Design system_; ADR-0076)
3. **Data access through the firm-scoped DAL.** All business data goes through the firm-scoped data-access layer — no query crosses firms; bulk content to R2, never D1. (_Tenancy & data isolation_; ADR-0003)
4. **Standardized error & bug logging.** Report every error/bug through the one standard in-house pipeline; **redact by default** (never log privileged content), correlate by ID, surface a user-facing Error ID, and never use a third-party error SaaS. Standard: [`docs/conventions/error-logging.md`](docs/conventions/error-logging.md). (_Observability & diagnostics_; ADR-0017, ADR-0038)
5. **Keep documentation current.** No feature is done until its docs (developer _and_ user) and [`ROADMAP.md`](ROADMAP.md) + [`CHANGELOG.md`](CHANGELOG.md) are updated — same commit. Standard: [`documentation.md`](docs/conventions/documentation.md); language: [`documentation-style.md`](docs/conventions/documentation-style.md).
6. **Feature parity.** Web and desktop stay at parity; no platform-exclusive features (desktop only adds optional local accelerations with a server fallback). (_Delivery model_; ADR-0023)
7. **No shell for file operations.** Dedicated file tools only; the shell is for git, pnpm, cargo, rustup, and process management.
8. **Design before code.** White paper → brainstorm → spec ([`docs/specs/`](docs/specs/)) → plan → build; record decisions as ADRs in [`docs/Decision-Log.md`](docs/Decision-Log.md), same commit.
9. **One home per fact.** Follow existing conventions; reference the white paper by topic name or `ADR-NNNN`, never a `§` number.
10. **Measure before optimizing; keep work off the hot path.** No heavy work in a request handler or on the UI main thread — offload to Containers/Queues/Web Workers; stream, don't buffer; no N+1. Optimize against the load-profile harness, not guesses. (_Performance & concurrency model_; ADR-0039)
11. **Implement on the latest — verify library docs first.** Before using or upgrading any library, look up its **current** documentation and build against the latest stable API/patterns (e.g. Svelte 5 **runes**, Tailwind v4, Vite+ `vp`) — never older idioms from memory. Web-search the docs when unsure. Getting it current up front avoids retrofitting the codebase later. (_Development guidelines_)
12. **Fully write out names — no shorthand.** Spell every name out in full across packages, code, and docs: `@magna-carta/identifiers` not `ids`, `@magna-carta/database` not `db`, `@magna-carta/data-access` not `dal`; `newIdentifier()` not `newId()`; "the data-access layer", never "the DAL". Clarity imposed now is cheap; decoding shorthand later is not, and it compounds across the codebase. Only exception: documented storage-encoding suffixes from an accepted spec (e.g. `amount_minor`, `rate_e4`) and universal external terms (`id`, `URL`, `JSON`, `SQL`). Standard: [`docs/conventions/code-style.md`](docs/conventions/code-style.md).
13. **Code explains itself; cite files, not process docs.** Source, tests, config, and consumer-facing strings (e.g. OpenAPI `description`s) carry **no references to process artifacts** — no `ADR-NNNN`, no "design spec" / "spec §N", no white-paper section citation, no "slice 0·N" / "Phase N", no "decided #N" / plan "Task N", no "spike". State the _reasoning_ inline, or point to a concrete file (another module, or a living standard in [`docs/conventions/`](docs/conventions/) **by path**). ADRs, specs, and plans are point-in-time process records that move, renumber, and get superseded; a comment that explains _why_ outlives them. Decisions are still recorded as ADRs (golden rule 8) — the [Decision Log](docs/Decision-Log.md) is their home, never the code. **One exception:** a _forward-looking_ slice/phase reference that names **when** an interim or seam gets replaced, or a feature gets built (e.g. "slice 0·6 swaps in the real email adapter", "built in Phase 2·3") — that states a real schedule, not a process-doc citation, and is allowed. Enforced in CI by a source-scan fitness function (`pnpm run lint:process-refs`). Standard: [`docs/conventions/code-style.md`](docs/conventions/code-style.md).

**Domain invariants (scoped).** Subsystem-specific correctness rules — the financial & trust ledger rules, and secrets/encryption — are hard but bind only in their area: see [`docs/conventions/invariants.md`](docs/conventions/invariants.md) and the local `CLAUDE.md` of the area you are working in.

## How we work

- **Build in vertical slices:** each feature complete through every layer (schema → firm-scoped data-access layer → API → UI → tests → docs), not horizontal layers — each slice ships working and is perf-tested against the load-profile fixtures as built.
- **Build when in the area:** when a slice is open, include the cheap-from-the-getgo / expensive-to-retrofit parts up front — seams, schema columns, instrumentation. "Build when measured" gates are for heavy machinery only (golden rule 10 governs optimization, not foundations). (ADR-0078)
- **Implementation:** autonomous and terse; comprehensive fixes over incremental patches. Design and brainstorming stay collaborative.
- **Per-area `CLAUDE.md`:** each code area carries its own (template in [`docs/conventions/`](docs/conventions/)) for local rules and the domain invariants that apply there — keep cross-cutting rules in `docs/conventions/`, not duplicated locally.

## Commands

```
vp install                                                              # deps (vp manages pnpm + Node version)
vp dev                                                                  # web SPA dev server only (Vite HMR, no Worker)
vp run worker-dev                                                       # full local app: builds the SPA, then runs wrangler dev (Miniflare: local D1/R2/Queues)
vp run build-all                                                        # build all apps in dependency order
vp test                                                                 # unit + integration (Vitest, single-run; includes the Miniflare worker integration test)
pnpm check                                                              # full quality gate: vp check (fmt+lint+TS-typecheck) AND svelte-check (.svelte); CI runs this, not bare vp check
pnpm --filter @magna-carta/worker exec wrangler deploy --dry-run        # validate deploy without pushing
cargo test  /  cargo clippy                                             # Rust
```

## Where to look next

**Live status:** [`ROADMAP.md`](ROADMAP.md) · **Changes:** [`CHANGELOG.md`](CHANGELOG.md) · **Phase strategy, roadmap rationale & open research:** the [white paper](docs/Magna-Carta-White-Paper.md).
