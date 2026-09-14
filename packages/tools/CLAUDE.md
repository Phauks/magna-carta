# @magna-carta/tools — local notes

Pure presentation/IA layer for the Tools area — the single catalog feeding both the Tools sidebar
and contextual entry points. No D1, no Hono, no `env`, no Svelte, no network. Depends only on
`@magna-carta/access-control` (the `Permission` type + validation).

- A `ToolManifest` is `{ id, name, icon, subjectGroup, permission, contextTags, backing, matterContext }`,
  plus an optional `route`. Adding a tool is one row in `src/catalog.ts` (and, for the UI, one
  id->component mapping in the shell).
- **`route` is for a tool that has outgrown this area.** A tool is normally addressed at `/tools/<id>`;
  one that has earned a sidebar destination of its own says where it lives instead, and keeps its
  manifest row so the contextual surfacing path still has a tool to offer for its context tag.
  `toolRoute(tool)` is the single derivation — no consumer builds `/tools/<id>` by hand. `file-workbench`
  is the only such row today (`/file-workbench`).
- `backing: "library"` = self-contained (a link generator OR an interactive widget) — no connection.
  `backing: { kind: "integration", category }` stores only the category string; the shell reflects that
  integration's connection state. This layer never touches the integration framework or credentials.
- `toolsByGroup` feeds the sidebar (grouped by subject, fixed order, empty groups omitted);
  `toolsFor(tag)` feeds contextual surfaces (e.g. a Location calls `toolsFor("address")`). Both gate on
  the principal's permission set.
- The fitness test (`test/purity.test.ts`) forbids importing any tool-logic package or UI — keep the
  catalog above the tools, never below them.
- **A new manifest needs its `role_permission` seed in the same commit.** Both selectors gate on the
  member's permission set and nothing in `packages/data-access` writes that table, so a manifest whose
  key no migration seeds is a tile literally nobody has ever seen — not a tile awaiting a decision.
  Five shipped that way: the property, county-records, business-entity, attorney-licence and shipping
  manifests were declared in the baseline registry against a Tools shell that did not exist yet, the
  shell landed, and the seeding never followed, so four whole subject groups rendered for no seat on
  any firm until 2026-08-19. Seed it whatever the tool's UI stage is: eleven of the seeded tools have
  no page and render as "Soon", which is the state the listing page is built for.
  `pnpm run lint:ungranted-permissions` now fails a manifest with no seed behind it.
- **The reach a tool's key gets follows what the tool touches, not what it does.** A credential-less
  public-record lookup goes to every default role (`tools:whois`, `tools:safeBrowse`,
  `tools:attorneyLicense` and the rest) — it reads nothing of the firm's and stores nothing, so
  holding it reveals nothing the member could not already reach. A manifest backed by a connected
  vendor account matches the key that gates its operations instead: `tools:shipping` is Owner/Admin
  because `shipping:manage` is, and a wider tile would be a tool whose every button the holder's role
  refuses.

Seams (see `docs/specs/2026-06-16-tools-area-design.md`, ADR-0101): the sidebar/contextual UI + the
id->component map + the integration Dispatch/health branching land with the design-system shell; the
"every integration category resolves" fitness is a worker-side follow-on. Role-seeding is **done** —
every one of the nineteen manifests has a `role_permission` seed behind it, the last five in
`packages/database/drizzle/per-firm/20260819T220000_seed-document-editing-and-tools-permissions.sql`
— and is no longer a seam to be picked up later; see the rule above. The network speed test (diagnostics) is already a catalog manifest (`network-speed-test`,
`tools:speedTest`); only its UI widget — built on `@cloudflare/speedtest`, client-side against the
Cloudflare edge — is pending the shell. Firm-usage diagnostics (see
`docs/specs/2026-06-17-firm-usage-diagnostics-design.md`, ADR-0103) now has its headless reads built
(`readStorageUsage`/`summarizeStorageMeterRows` + file/version/folder counts in
`@magna-carta/file-manager`, `readMatterCounts` in `@magna-carta/matters`, `readLocationCount` in
`@magna-carta/locations`) and its `firm-usage` manifest wired in the catalog (`tools:firmUsage`); its
reads are now exposed via `GET /api/v1/firm-usage` (through the slice 0·5 chokepoint, gated by
`tools:firmUsage`), and `tools:firmUsage` is seeded to the Owner/Admin role (migration
`0006_seed-tools-firm-usage`); only the UI widget remains pending. Future catalog rows: an Avery template printer (printing).
