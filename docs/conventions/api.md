# API conventions

**Status:** Stub — to be written in the Phase 0 API spike (white paper, _Delivery model_).

**Scope (single home for):** how HTTP APIs are defined, evolved, and consumed — the contract toolchain, versioning, error shape, and internal vs. public calls.

**Authoritative context:** the [white paper](../Magna-Carta-White-Paper.md) — _Delivery model_ (REST + OpenAPI 3.1 on Hono; code-as-contract; the implementing-library spike). Once the spike resolves the library, record it in [`../Decision-Log.md`](../Decision-Log.md) and detail usage here.

**To document:**

- **Code-as-contract:** define each endpoint once with zod → typed TS client + emitted OpenAPI 3.1 spec; no hand-maintained YAML.
- The chosen implementing library (oRPC vs. ts-rest vs. `@hono/zod-openapi`/chanfana) — pending the Phase 0 spike.
- CI spec toolchain: Spectral lint, Prism mocks, SDK generation, oasdiff breaking-change detection.
- Versioning and breaking-change policy.
- Standard error envelope and the user-visible **Error ID** correlation (ties to _Observability_).
- **Internal calls:** plugin↔core via service bindings (native Worker RPC), separate from the public surface.
- Auth: how Better Auth routes mount; how requests carry firm/session context.

> tRPC and GraphQL were rejected — see [`../Decision-Log.md`](../Decision-Log.md) (ADR-0022).
