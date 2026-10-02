# @magna-carta/integrations — local notes

The ports-and-adapters foundation every integration plugs into. Pure package — no D1, no Hono, no
`env`; all I/O arrives through injected ports (`ConnectionStore`, `CredentialStore`, `TokenRefresher`).

- A **port** is a TS interface named in our domain vocabulary, defined by the consuming domain
  package (e.g. `ParcelLookupPort` in `@magna-carta/government-links`), never here and never a vendor's shape.
- An **adapter** implements one port; its `CapabilityDescriptor` declares what it supports so callers
  degrade gracefully. Credential-less adapters declare `credential: { kind: "none" }`; credentialed
  ones declare `{ kind: "oauth", scope: "firm" | "user" }` — the port picks the scope.
- Canonical records carry `remoteId` + opt-in `raw`; build the schema with `canonicalRecordSchema`,
  which validates the boundary (external data is untrusted).
- `resolve()` returns a typed `Dispatch` — `not-connected` / `capability-unsupported` /
  `credential-store-not-implemented` / `credential-forbidden` / `adapter-error`, never a throw. A
  `CredentialStore` may raise exactly one error, `CredentialAccessForbiddenError`, which the registry
  catches and returns as `credential-forbidden`; that is what lets the promise hold while a store
  enforces a permission. Never fold it into `not-connected` — the account IS connected, and the
  remedy is a grant rather than a reconnect. Adapters map vendor errors into
  `IntegrationProblem` (the `category` drives retry + the connection health state machine).
- **A deployment with no per-firm credential read is a first-class outcome, not a throw.** Hand the
  registry `unbuiltCredentialStore` and every credentialed resolution answers
  `credential-store-not-implemented`. Never fold it into `not-connected`: a firm fixes that one by
  connecting an account, and this one only a build fixes, so the two send a member to different
  places. Same shape as `engine-not-implemented` in `packages/conversion/src/port.ts`.

**Seams built with the first credentialed adapter (email/calendar):** the per-firm
`integration_connection` D1 repository, the slice-1·2 `firm_secret`-backed `CredentialStore`, the
Durable-Object refresh lock, and the worker connection-management/OAuth routes. The credential-less
`government-links` county deep-link resolver is the first adapter (one port, many adapters across the
credential boundary; Regrid/ATTOM follow). See the design spec:
`docs/specs/2026-06-16-integration-port-system-design.md` (ADR-0091, ADR-0092).
