# Slice Status

<!-- Generated from status.d/* by `vp run status-build` — do not hand-edit. To change a slice's
status, edit its fragment `status.d/<slice>.md`; the machine-readable index is STATUS.json. -->

Per-slice progress across the build pipeline — the **stage-status home**. [`ROADMAP.md`](ROADMAP.md) owns the narrative scope and ordering; [`CHANGELOG.md`](CHANGELOG.md) owns what shipped; this page tracks only _where each slice sits in the pipeline_. **Notes are one line** — the detail lives in ROADMAP / the slice spec / CHANGELOG, not here.

This file is a **build output**: `vp run status-build` assembles it (and [`STATUS.json`](STATUS.json), the machine-readable index) from per-slice fragments in [`status.d/`](status.d/). Edit a slice's `status.d/<slice>.md` fragment the moment it changes stage — never this file — so parallel branches never collide (the `changelog.d/` → `CHANGELOG.md` pattern). Authoring guide: [`status.d/README.md`](status.d/README.md).

## Stages

- **Research** — a pre-design research doc in [`docs/research/`](docs/research/). `[-]` where a slice went straight to design.
- **Spec** — a design doc in [`docs/specs/`](docs/specs/).
- **Plan** — an implementation plan in [`docs/specs/`](docs/specs/).
- **Built** — implemented (TDD). The 7-angle adversarial review runs _during_ build, so Built means implemented-and-reviewed.
- **UI** — the user-facing surface. Gated on the design-system shell (0·7a) + first human-operable surfaces (0·7b); under the model-split policy UI is a **Fable matter**, so most cells read **deferred until Fable** (`[ ]`) even where the backend is `[x]`. `[-]` = no user-facing surface (pure backend libraries).
- **Load profile** — the slice extended the volume harness in-area (the accretion rule, ADR-0078/0083). Default-bound for any slice touching per-firm data; `[-]` where it adds no per-firm data surface.
- **Tested** — the separate independent verification pass against the _landed_ slice, distinct from the in-build review.

**Markers:** `[x]` complete · `[~]` in progress · `[ ]` not started · `[-]` not applicable.

**Model attribution.** An untagged completed cell was built and verified by **Fable 5** (the baseline to date). When another model does the work, suffix the marker with the full model name + version (`[x] Opus 4.8`). Append `↻` when the cell still awaits an independent **Fable 5** pass; a trailing **`*`** marks work done under **Opus during the Fable-access gap** (same awaited-Fable obligation). Both clear to a plain `[x]` once Fable re-confirms.

## Phase 0 — Foundation

{{table:phase-0}}

## Phase 1 — Core domain (firm + matters)

{{table:phase-1}}

## Phase 2 — Documents & file management

{{table:phase-2}}

## Cross-cutting — phase-independent slices

{{table:cross-cutting}}

## Phase 3 — Financial Core (slice map firmed up; per-slice rows as cycles open)

Slice set firmed up in the [phase-3 slice map](docs/specs/2026-06-21-phase-3-financial-core-slice-map.md) (3·1 Time · 3·2 Trust · 3·3 Costs · 3·4 Billing · 3·5 Operating GL · 3·6 Reports · 3·7 Automations). Rows appear as each design cycle opens.

{{table:phase-3}}

## Phase 4 — Conflicts & Custodian (first slice open)

{{table:phase-4}}

## Phase 6 — Client-facing & scheduling (first slice open)

{{table:phase-6}}

## Phases 5 and 7 — sliced provisionally (no rows yet)

Sliced provisionally in [`ROADMAP.md`](ROADMAP.md) (Phase 5 Discovery · Phase 7 Integrations) — scope, not design. Rows appear here once a slice's design cycle opens.
