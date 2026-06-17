# @magna-carta/tools — local notes

Pure presentation/IA layer for the Tools area — the single catalog feeding both the Tools sidebar
and contextual entry points. No D1, no Hono, no `env`, no Svelte, no network. Depends only on
`@magna-carta/access-control` (the `Permission` type + validation).

- A `ToolManifest` is `{ id, name, icon, subjectGroup, permission, contextTags, backing, matterContext }`.
  Adding a tool is one row in `src/catalog.ts` (and, for the UI, one id->component mapping in the shell).
- `backing: "library"` = self-contained (a link generator OR an interactive widget) — no connection.
  `backing: { kind: "integration", category }` stores only the category string; the shell reflects that
  integration's connection state. This layer never touches the integration framework or credentials.
- `toolsByGroup` feeds the sidebar (grouped by subject, fixed order, empty groups omitted);
  `toolsFor(tag)` feeds contextual surfaces (e.g. a Location calls `toolsFor("address")`). Both gate on
  the principal's permission set.
- The fitness test (`test/purity.test.ts`) forbids importing any tool-logic package or UI — keep the
  catalog above the tools, never below them.

Seams (see `docs/specs/2026-06-16-tools-area-design.md`, ADR-0097): the sidebar/contextual UI + the
id->component map + the integration Dispatch/health branching land with the design-system shell; role-
seeding the `tools:` permissions and the "every integration category resolves" fitness are worker-side
follow-ons. The network speed test (diagnostics) is already a catalog manifest (`network-speed-test`,
`tools:speedTest`); only its UI widget — built on `@cloudflare/speedtest`, client-side against the
Cloudflare edge — is pending the shell. Future catalog rows: an Avery template printer (printing).
