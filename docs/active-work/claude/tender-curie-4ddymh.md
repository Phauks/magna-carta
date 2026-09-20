---
worktree: C:/dev/magna-carta-worktrees/claude/tender-curie-4ddymh
area: Shipping & postage completion — the credential gate that makes the built backend reachable, and the four surfaces over it
status: review
touches: docs/specs/, apps/api-worker/src/plugins/credential-store.ts, apps/api-worker/src/protected-read-context.ts, apps/api-worker/src/routes/shipping.ts, apps/web/src/routes/(app)/shipping/, apps/web/src/routes/(app)/settings/shipping/, apps/web/src/lib/shipping/, apps/web/src/lib/settings/settings-sections.ts, apps/web/src/lib/screen/screen-header.ts, apps/web/src/lib/tools/tool-presentation.ts, packages/access-control/src/registry.ts, packages/data-access/src/integration-credential-statements.ts, packages/data-access/src/integration-credential-store.ts, packages/identifiers/src/, packages/integrations/src/, packages/magnus/src/limits.ts, packages/tools/src/catalog.ts, packages/database/drizzle/per-firm/, tooling/lint-back-navigation/, roadmap.d/integrations.md, status.d/
---

Completes shipping and postage. The carrier operations answered 501 on every call because the
per-firm credential read had no home; this stream gives integration credentials their own gate
(`integrations:useConnection`) and their own protected column rather than borrowing the firm-secret
one, then builds the four surfaces the June design predates — the register, the shipment window, the
buy wizard, and a dedicated postage-account settings page.

**Built, not planning.** Anything touching the shipping routes, `apps/api-worker/src/plugins/`,
`packages/integrations/`, or the per-firm migration lineage collides with this stream.
`apps/api-worker/src/plugins/secret-store.ts` no longer exists — it is `credential-store.ts` here.

One change sits outside the area and is unrelated to shipping: `packages/magnus/src/limits.ts`
carried a literal U+FFFD in a `u`-flagged regex that is used, which hangs the linter indefinitely and
silently took the whole-repository lint pass down with it. It is escaped here because this stream is
what found it.
