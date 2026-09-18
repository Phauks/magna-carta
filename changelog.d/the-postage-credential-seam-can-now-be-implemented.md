---
category: Changed
audience: internal
---

The per-firm secret-store seam takes a protected-field read context rather than a bare database handle, so an implementation of it is now possible to write.

Every carrier operation on the shipping routes answers 501 because `firmSecretStoreNotYetAvailable` returns `null`, and the reason it was never replaced is that the seam's own signature made the replacement unwritable: `getSecret` gates and audits its decrypt, so it needs the firm key, the per-firm database, the caller's effective permissions, the acting user and a clock, and the seam was handed only the database. `SecretStoreForFirm` now takes the whole `ProtectedReadContext`, which also satisfies `putSecret`, and `buildIntegrationRegistry` scopes the connection store and the credential store to that one context so the two cannot address different firms.

`apps/api-worker/src/protected-read-context.ts` is the one place that context is now built. Three route modules assemble it by hand — directory, conflicts and matter-assets — and `conflicts.ts` says in its own comment that it mirrors `directory.ts`; those three are left where they are for now, because moving them changes what a support session may decrypt. The new helper reads the permission set the chokepoint already resolved and stashed rather than re-deriving it, which drops a database round trip per request and is the more faithful answer for a support principal, whose permissions come from their support tier and not from the firm roles of the member whose id the re-derivation would use.

No behaviour changes yet: the production seam still reports its absence and the five carrier operations still answer 501. What decides the implementation is which permission an operational credential read runs under — the routes gate on `shipping:manage` while the stored value is declared readable with `firm:manageSecrets` — and that is an open question recorded in `docs/specs/2026-09-18-shipping-postage-completion-implementation-plan.md`.
