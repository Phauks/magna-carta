# Conventions

Cross-cutting **standards** for how code in Magna Carta is written — the imperative "how," kept separate from the white paper's "why." Each file here is the single home for one standard; the white paper section it derives from is cited, not restated.

These are rules. Rationale lives in the white paper; decisions and their status live in [`../Decision-Log.md`](../Decision-Log.md); the hard invariants that must never break are summarized in the root [`CLAUDE.md`](../../CLAUDE.md).

References to the white paper below name the **area**, not a section number — section numbers shift when the paper is reorganized (see the cross-reference policy in the root [`CLAUDE.md`](../../CLAUDE.md)).

| File                                                     | Covers                                                                            | White-paper area                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [`invariants.md`](invariants.md)                         | Domain (subsystem) invariants — financial/trust, secrets/encryption               | Financial Core; Trust; Encryption                       |
| [`documentation.md`](documentation.md)                   | Documentation standard: definition-of-done, audiences, changelog/roadmap upkeep   | User-facing documentation; Development guidelines       |
| [`documentation-style.md`](documentation-style.md)       | Writing language: change types, commit/changelog style, templates, glossary       | Development guidelines                                  |
| [`error-logging.md`](error-logging.md)                   | Error & bug logging standard: in-house reporter, incidents, diagnostics agent     | Observability & diagnostics                             |
| [`performance.md`](performance.md)                       | Compute placement, resource discipline, measure-first profiling                   | Performance & concurrency model                         |
| [`network-resilience.md`](network-resilience.md)         | Behaving well on slow/metered/intermittent links: resumable transfer, budgets     | Delivery model; Performance & concurrency model         |
| [`build-performance.md`](build-performance.md)           | Fast builds: caching, path-filtering, build-time baking — the build feedback loop | Development guidelines; Performance & concurrency model |
| [`settings.md`](settings.md)                             | Settings registry framework: scope resolution, access, storage                    | Settings & configuration                                |
| [`code-style.md`](code-style.md)                         | Language-agnostic style principles + per-language index                           | Development guidelines                                  |
| [`typescript.md`](typescript.md)                         | TypeScript style, Oxlint/Oxfmt, zod, Svelte 5 runes                               | Delivery model; Development guidelines                  |
| [`rust.md`](rust.md)                                     | Rust style, rustfmt/clippy, WASM/native discipline                                | Delivery model; Development guidelines                  |
| [`ui-design.md`](ui-design.md)                           | Lucide-only icons, design tokens, design-system components                        | Design system                                           |
| [`testing.md`](testing.md)                               | Test strategy, fixtures, determinism, visual regression                           | Synthetic data & fixtures                               |
| [`security.md`](security.md)                             | Firm-scoping, RBAC/ethical walls, encryption, telemetry redaction, PCI            | Tenancy; Auth & encryption; Observability               |
| [`compliance.md`](compliance.md)                         | Framework map: SOC 2 / GDPR / PCI DSS / ISO 27001 controls + gap register         | Tenancy; Auth & encryption; Payments; Observability     |
| [`api.md`](api.md)                                       | REST/OpenAPI code-as-contract, versioning, internal RPC                           | Delivery model                                          |
| [`operations.md`](operations.md)                         | Deploy-time platform config: Logpush, email DNS, secrets, D1 bindings, audit      | Observability; Communications; Delivery model           |
| [`third-party-trademarks.md`](third-party-trademarks.md) | Third-party brand/logo usage register: guidelines, assets, constraints, fallback  | Plugin / Add-on system; Distribution & IP (ADR-0090)    |
| [`area-claude-template.md`](area-claude-template.md)     | Template for per-area `CLAUDE.md` files                                           | —                                                       |

> **Status:** `invariants.md`, `documentation.md`, `documentation-style.md`, `error-logging.md`, `performance.md`, `network-resilience.md` (resumable-transfer seam + degradation rules active; client transport seam + budget gate deferred), `build-performance.md`, `settings.md`, `testing.md` (framework decided), and `operations.md` are **active** (they apply now); `security.md` is **active in part** (auth & secrets operational facts, untrusted file handling, post-quantum rules); `compliance.md` is **active as a map** (it links controls to frameworks and registers gaps; the controls and attestations it points to follow their own homes). The rest are **stubs** describing scope and authoritative source; each is filled in as the corresponding subsystem is built (docs change in the same commit as code).
