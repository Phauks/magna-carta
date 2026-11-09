# @magna-carta/tools — local notes

Pure presentation/IA layer for the firm's standalone tools — the single catalog feeding both the
rail's Tools group and contextual entry points. No D1, no Hono, no `env`, no Svelte, no network.
Depends only on `@magna-carta/access-control` (the `Permission` type + validation).

- A `ToolManifest` is `{ id, name, icon, subjectGroup, permission, contextTags, backing, matterContext }`.
  Adding a tool is one row in `src/catalog.ts` (and, for the UI, a route and a presentation entry in
  the web app).
- **Every tool is a TOP-LEVEL ABILITY, addressed at `/<id>`** (owner's direction, 2026-09-16).
  `toolRoute(tool)` is the single derivation and every consumer goes through it. There is no Tools
  AREA any more — no `/tools` layout, no index, no `/tools/<id>` — so there is no `route` field
  either: an escape hatch from a prefix that does not exist is a field that can only be wrong. The
  two-sided screen cost every tool a navigation column listing the tools it is not, and the index
  that briefly replaced it was a stop on the way to work; the descriptors and the search it carried
  were never its own (the presentation layer's, rendered by the command palette).
- **`subjectGroup` is the rail CLUSTER a tool folds into**, and the four are named for what a member
  is doing: `records`, `internet`, `mailing`, `files`. There were eight, which over nine tools is a
  heading per tool. The cluster's NAME and glyph are not here — they live where the rail draws them
  (`apps/web/src/lib/navigation/clusters.ts`), because a cluster is a thing the interface renders.
- `file-workbench` is the only row in `files`, and deliberately so: the ten file utilities that used
  to sit beside it were its own capability tabs under another name and were retired into them. **A
  new `files` row means somebody is re-opening a door the workbench already has** —
  `test/catalog.test.ts` fails on one.
- **Retiring a manifest does not retire its permission.** The nine `tools:*` keys those rows declared
  are still what gates the workbench's capability tabs, so the access-control registry entries and
  their `role_permission` seeds stay. What changed is who grants them: `grantedPermissions()` built
  its set from `CATALOG`, so the deletion would have emptied the tab strip silently. The web app's
  `tool-permissions.ts` names them explicitly now, held to the capability registry by a test. The
  same applies to `tools:firmUsage`: Firm Usage left this catalog for the Firm group (a tool is a
  utility a member RUNS, and reading the firm's own records is not one) and its key is named there
  too, carried on the destination through `Destination.permission`.
- `backing: "library"` = self-contained (a link generator OR an interactive widget) — no connection.
  `backing: { kind: "integration", category }` stores only the category string; the shell reflects that
  integration's connection state. This layer never touches the integration framework or credentials.
- `toolsByGroup` feeds the rail (grouped by subject cluster, clusters in fixed order, empty clusters
  omitted, tools **alphabetical by name** within a cluster — a member scans for a name, and catalog
  order is a fact about this repository); `toolsFor(tag)` feeds contextual surfaces (e.g. a Location
  calls `toolsFor("address")`). Both gate on the principal's permission set.
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
  vendor account matches the key that gates its operations instead: `tools:shipping` is Admin
  because `shipping:manage` is, and a wider tile would be a tool whose every button the holder's role
  refuses.

Seams (see `docs/specs/2026-06-16-tools-area-design.md`, ADR-0101 — written while there was still an
area, so read its screen shape as history rather than as the plan): the contextual entry points and
the integration Dispatch/health branching are what is left. Role-seeding is **done** — every manifest
has a `role_permission` seed behind it, the last five in
`packages/database/drizzle/per-firm/20260819T220000_seed-document-editing-and-tools-permissions.sql`
— and is no longer a seam to be picked up later; see the rule above. Five tools have a page today
(the attorney-license lookup, the network speed test, the safe website viewer, the WHOIS lookup and
the File Workbench); the rest read "Soon" on their rail row, which is the state the row is built for.
Firm-usage diagnostics (`docs/specs/2026-06-17-firm-usage-diagnostics-design.md`, ADR-0103) is no
longer one of these rows at all: its reads, its route and its screen are built, and it is a Firm
destination. Future catalog rows: an Avery template printer, in the `mailing` cluster that the
printing subject folded into.
