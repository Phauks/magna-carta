# @magna-carta/worker-secrets — CLAUDE.md

**Purpose.** Lets a Worker's secrets live in the account's Cloudflare Secrets Store instead of on
each Worker. A store secret reaches a Worker as a binding whose value is fetched with
`await binding.get()`; every reader in the codebase wants a plain string. `resolveStoredSecrets`
turns the one into the other once, at the Worker's entry, so nothing downstream changes.

**Runbook:** [`docs/conventions/operations.md`](../../docs/conventions/operations.md), _Secrets
Store_ (which secret lives where, and the order a secret moves in).

## Key files

- `src/stored-secrets.ts` — `resolveStoredSecrets(env, names)`, `secretSourcesOf(env, names)` and
  `SECRETS_STORE_BINDING_PREFIX`.

## Local rules

- **Resolve at the entry, never at the read.** Each Worker calls `resolveStoredSecrets` in its
  `fetch`, `queue` and `scheduled` handlers, and the app Worker's Durable Objects do it in their
  constructor (`apps/api-worker/src/stored-secrets.ts`). A reader that awaits a
  store binding itself is a second path that the System Status page cannot see.
- **The list of names is the Worker's own.** Each Worker keeps the names it reads beside its
  bindings; a secret that is not on that list is never looked for in the store.
- **A store binding is committed as `SECRETS_STORE_<NAME>`.** The separate name is what lets the
  store copy and the per-Worker copy exist together during a move. A store binding under the plain
  name is also read, because that is what the dashboard produces, but it cannot coexist with the
  per-Worker copy.
- **Never log a value or a store error.** A failed read becomes "absent" and is reported by
  `secretSourcesOf`; the error itself can name the secret and is dropped.

## Gotchas

- Locally (Miniflare) a store binding is an RPC stub on which every property is a function, so a
  store binding is recognised by having `get()` and nothing narrower.
- With no store binding among the names, the SAME environment object is returned. Tests that pass
  their own environment therefore see no change.
- Values are kept per isolate for five minutes (a failed read for thirty seconds), so a value
  changed in the store reaches a warm isolate within that window.
