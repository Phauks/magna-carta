# Slice Status

Per-slice progress across the build pipeline — the **stage-status home**. [`ROADMAP.md`](ROADMAP.md) owns the narrative scope and ordering; this page tracks _where each slice sits in the pipeline_. Update a cell the moment a slice changes stage (same in-commit discipline as ROADMAP/CHANGELOG).

## Stages

- **Research** — a pre-design research doc in [`docs/research/`](docs/research/) for an under-specified slice (the open subsystems get one before their design cycle). `[-]` where a slice went straight to design.
- **Spec** — a design doc in [`docs/specs/`](docs/specs/).
- **Plan** — an implementation plan in [`docs/specs/`](docs/specs/).
- **Built** — implemented (TDD). **In this workflow the 7-angle adversarial review runs _during_ build**, so Built means implemented-and-reviewed — review is not a separate column.
- **Tested** — the separate, independent verification pass run against the _landed_ slice (the dedicated testing pass), distinct from the in-build review.

**Markers:** `[x]` complete · `[~]` in progress · `[ ]` not started · `[-]` not applicable.

## Phase 0 — Foundation

| Slice                                                                  | Research | Spec | Plan | Built | Tested | Notes                                                            |
| ---------------------------------------------------------------------- | :------: | :--: | :--: | :---: | :----: | ---------------------------------------------------------------- |
| 0·1 — Walking skeleton                                                 |   [-]    | [x]  | [x]  |  [x]  |  [x]   | Shipped (CI → Wrangler deploy).                                  |
| 0·2 — Foundational data (money · identifiers · database · data-access) |   [-]    | [x]  | [x]  |  [x]  |  [x]   | Four packages; one design + four package plans.                  |
| 0·3 — Ledger core + fixtures                                           |   [-]    | [x]  | [x]  |  [x]  |  [x]   | Built + 10-finding adversarial pass (during build).              |
| 0·4 — Auth + RBAC skeleton + firm provisioning                         |   [-]    | [x]  | [x]  |  [~]  |  [ ]   | Build in progress (active session).                              |
| 0·5 — API contract pipeline                                            |   [-]    | [x]  | [x]  |  [ ]  |  [ ]   | Spec = the 2026-06-04 API-contract design (no new design cycle). |
| 0·6 — Telemetry baseline + platform closeout                           |   [-]    | [x]  | [x]  |  [ ]  |  [ ]   | Backend + CI only.                                               |
| 0·7a — Design-system foundation                                        |   [-]    | [x]  | [x]  |  [~]  |  [ ]   | Token pipeline + component layer (build in progress).            |
| 0·7b — Auth UI + deferred surfaces                                     |   [-]    | [ ]  | [ ]  |  [ ]  |  [ ]   | Own design cycle when it starts.                                 |

## Phase 1 — Core domain (firm + matters)

| Slice                                    | Research | Spec | Plan | Built | Tested | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | :------: | :--: | :--: | :---: | :----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1·1 — Matters + Locations + File Manager |   [x]    | [x]  | [~]  |  [ ]  |  [ ]   | Spec: [`2026-06-11-slice-1-1-matters-locations-file-manager-design.md`](docs/specs/2026-06-11-slice-1-1-matters-locations-file-manager-design.md) (ADR-0079–0082). Backend plan: [`2026-06-11-slice-1-1-backend-implementation-plan.md`](docs/specs/2026-06-11-slice-1-1-backend-implementation-plan.md); the UI plan is written once 0·7a/0·7b are Built. Research: [`slice-1-1-file-manager-storage.md`](docs/research/slice-1-1-file-manager-storage.md). |
| 1·2 — `protected()` crypto module        |   [x]    | [x]  | [x]  |  [ ]  |  [ ]   | Spec: [`2026-06-12-slice-1-2-protected-crypto-module-design.md`](docs/specs/2026-06-12-slice-1-2-protected-crypto-module-design.md) (ADR-0084; ADR-0026 TOTP line closed). Plan: [`2026-06-12-slice-1-2-implementation-plan.md`](docs/specs/2026-06-12-slice-1-2-implementation-plan.md). Research: [`protected-crypto-module.md`](docs/research/protected-crypto-module.md).                                                                                |
| 1·3 — Directory                          |   [x]    | [ ]  | [ ]  |  [ ]  |  [ ]   | Research: [`conflicts-matching-engine.md`](docs/research/conflicts-matching-engine.md) (the 1·3 seams) + [`directory-mechanics.md`](docs/research/directory-mechanics.md) (custom fields, merge/unmerge, phonetic encoders — **all three owner-gated, go/no-go decided in the design cycle**).                                                                                                                                                               |

## Phase 2 — Documents & file management

| Slice                                               | Research | Spec | Plan | Built | Tested | Notes                                                                              |
| --------------------------------------------------- | :------: | :--: | :--: | :---: | :----: | ---------------------------------------------------------------------------------- |
| 2·1 — Inbound upload path + untrusted-file pipeline |   [~]    | [ ]  | [ ]  |  [ ]  |  [ ]   | Upload path researched in the 1·1 storage doc; malware-scan engine ADR still open. |
| 2·2 — Editing + versioning & storage tiering        |   [ ]    | [ ]  | [ ]  |  [ ]  |  [ ]   | Collabora + WOPI + app-managed versions.                                           |
| 2·3 — Inline preview + safe-delivery sandbox        |   [ ]    | [ ]  | [ ]  |  [ ]  |  [ ]   |                                                                                    |
| 2·4 — In-app conversion                             |   [ ]    | [ ]  | [ ]  |  [ ]  |  [ ]   |                                                                                    |
| 2·5 — PDF services + e-signature core               |   [ ]    | [ ]  | [ ]  |  [ ]  |  [ ]   | ADR-0045 (PDF/e-sign) is _Proposed_, not a slice spec.                             |
| 2·6 — Document automation                           |   [ ]    | [ ]  | [ ]  |  [ ]  |  [ ]   |                                                                                    |

## Cross-cutting — phase-independent slices

| Slice                | Research | Spec | Plan | Built | Tested | Notes                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | :------: | :--: | :--: | :---: | :----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Load-profile harness |   [-]    | [x]  | [x]  |  [ ]  |  [ ]   | Golden rule 10's measurer; spec: [`2026-06-11-load-profile-harness-design.md`](docs/specs/2026-06-11-load-profile-harness-design.md) (ADR-0083); plan: [`2026-06-11-load-profile-harness-implementation-plan.md`](docs/specs/2026-06-11-load-profile-harness-implementation-plan.md). V1 = harness machinery + ledger volume profile; every later domain slice extends it in-area. Build: next free session. |

## Phases 3–7 — not yet sliced

Tracked at phase level in [`ROADMAP.md`](ROADMAP.md) (Phase 3 Financial Core · Phase 4 Conflicts & Safe Custody · Phase 5 Discovery · Phase 6 Client-facing & scheduling · Phase 7 Integrations). Each gets its own slice breakdown when its design cycle opens. Several subsystem _designs_ already exist as ADRs (e.g. Notifications ADR-0059, Communications ADR-0047) but none has a slice spec yet, so they are not rows here.
