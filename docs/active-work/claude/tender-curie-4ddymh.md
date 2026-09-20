---
worktree: C:/dev/magna-carta-worktrees/claude/tender-curie-4ddymh
area: Shipping & postage completion — the credential gate that makes the built backend reachable, and the four surfaces over it
status: review
touches: docs/specs/, tooling/gate/, tooling/lint-control-characters.mjs, docs/conventions/code-style.md, docs/conventions/build-performance.md, apps/api-worker/src/plugins/credential-store.ts, apps/api-worker/src/protected-read-context.ts, apps/api-worker/src/routes/shipping.ts, apps/web/src/routes/(app)/shipping/, apps/web/src/routes/(app)/settings/shipping/, apps/web/src/lib/shipping/, apps/web/src/lib/settings/settings-sections.ts, apps/web/src/lib/screen/screen-header.ts, apps/web/src/lib/tools/tool-presentation.ts, packages/access-control/src/registry.ts, packages/data-access/src/integration-credential-statements.ts, packages/data-access/src/integration-credential-store.ts, packages/identifiers/src/, packages/integrations/src/, packages/magnus/src/limits.ts, packages/tools/src/catalog.ts, packages/database/drizzle/per-firm/, tooling/lint-back-navigation/, roadmap.d/integrations.md, status.d/
---

Completes shipping and postage. The carrier operations answered 501 on every call because the
per-firm credential read had no home; this stream gives integration credentials their own gate
(`integrations:useConnection`) and their own protected column rather than borrowing the firm-secret
one, then builds the four surfaces the June design predates — the register, the shipment window, the
buy wizard, and a dedicated postage-account settings page.

**Built, not planning.** Anything touching the shipping routes, `apps/api-worker/src/plugins/`,
`packages/integrations/`, or the per-firm migration lineage collides with this stream.
`apps/api-worker/src/plugins/secret-store.ts` no longer exists — it is `credential-store.ts` here.

**Three changes sit outside the area and are unrelated to shipping**, all from one root cause this
stream tripped over. `packages/magnus/src/limits.ts` carried a literal U+FFFD in a `u`-flagged regex
that is used, which hangs the linter indefinitely and silently took the whole-repository lint pass —
and with it the gate of record — down for six days. Escaped here.

Then the two things that stop it recurring, at the owner's direction: `tooling/gate/` gains a per-step
time budget so a check that never finishes is reported as `NO END` instead of reading as a slow
machine, and `tooling/lint-control-characters.mjs` gains U+FFFD so the character cannot come back. Both
touch cross-cutting files (`docs/conventions/code-style.md`, `docs/conventions/build-performance.md`)
and the gate every other stream runs — **a stream changing `tooling/gate/` collides with this one.**

Two pre-existing failures were repaired in passing because they blocked the gate for every branch, not
just this one: the magnus hang above, and two `docs/research/` files that landed unformatted in #651
(they landed unformatted _because_ the gate could not run).
