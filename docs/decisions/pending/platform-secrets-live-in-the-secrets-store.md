---
slug: platform-secrets-live-in-the-secrets-store
status: Accepted
area: Operations
date: 2026-11-13
summary: "The platform's secrets move from per-Worker secrets into the account's Cloudflare Secrets Store, one at a time. Each Worker resolves a store binding named SECRETS_STORE_<NAME> into the plain string its code already reads, at its entry, and falls back to the per-Worker secret, so a secret moves with no gap and the code that reads it does not change."
---

**The platform's secrets live in the account's Secrets Store, bound into each Worker that reads them.** Asked for by the owner on 2026-11-13.

**Context.** About thirty secrets are set by hand on six Workers in the dashboard, one Worker at a
time, and `COMMUNITY_HANDOFF_SECRET` has to be set identically on two of them. The owner wanted one
place to see and change them. Cloudflare Secrets Store keeps secrets at the account level and binds
them into Workers; it is in open beta, allows 100 secrets and one store per account, and never shows
a value back once saved.

**Decision.**

- A store binding is committed in `wrangler.jsonc` as `SECRETS_STORE_<NAME>`, never added only in the
  dashboard: a deploy replaces the bindings with the committed ones, and a merge to `main` deploys.
- The separate name lets the store binding and the per-Worker secret exist together, so a secret
  moves with no window in which a Worker lacks it: bind from the store, confirm, then delete the
  per-Worker copy.
- Each Worker resolves its store bindings once, at its entry (and the app Worker's Durable Objects in
  their constructor), through `packages/worker-secrets`. Readers keep reading a string. A store
  binding that cannot be read falls back to the per-Worker secret and is reported as such.
- The owner keeps a master copy of every value in a password manager, because the store cannot show
  one back.

**Consequences.** The Workers Builds API token needs Secrets Store edit permission before the first
binding is committed. A value changed in the store reaches a warm isolate within five minutes. The
`secrets.required` deploy gate only sees per-Worker secrets, so a required name leaves that list in
the change that binds it from the store. The runbook is `docs/conventions/operations.md`, _Secrets
Store_.
