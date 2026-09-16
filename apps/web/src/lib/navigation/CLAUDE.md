# navigation — local notes

**Purpose.** Everything about where a member can go and how they get there: the destination registry,
the rail's clusters, the member's own visibility and favourites, the tool rows projected from the
catalog, and the palette's tool provider. The app shell renders it; this directory decides it.

**Rendered by:** `$lib/components/app-shell.svelte` (the rail) and `$lib/components/command-palette.svelte`
(Ctrl+K). **Rulings:** [`docs/conventions/design-corrections.md`](../../../../../docs/conventions/design-corrections.md).

## The four registries, and what each one owns

| File                            | Owns                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `destinations.ts`               | Every platform destination: membership, group, cluster, canonical order, the shipped/announced light-ups, and the permission a few of them carry |
| `clusters.ts`                   | The rail's sub-menus — a cluster's id, group, name and glyph                                                                                     |
| `tool-sidebar.ts`               | The tool catalog projected into rail rows (the registry holds none of them)                                                                      |
| `favorites.svelte.ts`           | The member's own shortcuts — not platform data, and never declared here                                                                          |
| `sidebar-preferences.svelte.ts` | The render tree: what this member shows, in what order, with which folds                                                                         |

**Nothing has two homes.** What a tool IS lives in `@magna-carta/tools`; what it looks like lives in
`$lib/tools/tool-presentation.ts`; where it is addressed is `toolRoute()`. This directory says which
of those facts fills which part of a row.

## The rules that are easy to get wrong

- **A CLUSTER IS A FOLD, NEVER A SCREEN.** It has no address, nothing is reached through it, and
  pressing it opens the rows. A cluster holding one row is seated as a plain row — a chevron hiding
  one thing costs a press and saves nothing. This is the whole difference between the Tools group and
  the `/tools` sub-page it replaced, which charged a navigation for the same grouping.
- **Three layers, three marks, three meanings** (owner ruling, 2026-09-16). PERMISSION decides
  whether a member may see a row at all — access control's, not a preference's, so a gated row is
  absent from the rail, from Customize and from the palette alike. SHOW/HIDE (the **eye**) is the
  member's choice about a platform row. FAVOURITE (the **star**) is the member's own shortcut to any
  address. Do not let one control answer two of them.
- **Hiding must never remove capability.** The palette renders the registry directly and is never
  filtered by a fold or by the eye: searching for a thing is wanting it.
- **The collapsed icon rail draws every row flat**, groups and clusters unfolded, because a rail with
  no visible labels has nothing to fold BY. `sidebarGroups()` returns both views for this reason —
  `destinations` (flat, the truth) and `nodes` (folded, how the expanded rail arranges it). A row in
  one and not the other is a row that disappears at one width.
- **Preferences store DEPARTURES, never state.** `visibilityOverrides` holds only rows the member
  moved off the registry default, and `collapsedGroups`/`collapsedClusters` only what they folded
  away. That is what lets a destination shipped later arrive visible and open rather than inheriting
  a preference nobody expressed.
- **A tool row is `pinned`**, deliberately. What a member sees in the Tools group is what they are
  permitted to run, and an eye beside a tool would be a second, inert answer to a question access
  control has settled. Customize leaves the group out whole for the same reason.
- **A favourite is keyed by PATHNAME** — no query string, because a favourite is a place and two
  addresses differing only in how a list is narrowed are the same place. Its glyph is resolved from
  the area it sits under at render time, so nothing has to be kept in step; its label is a snapshot
  of the screen's own title, which is why re-pressing the star on a saved page updates the name in
  place rather than moving the row.
- **`tool-destinations.ts` and `tool-sidebar.ts` import app modules by RELATIVE path**, and neither
  import is type-only: both are exercised by unit tests in vitest's plugin-less node pool, where the
  SvelteKit `$lib` alias is not resolved.

## Where a screen says where it came from

`$lib/screen/screen-header.ts`, not here. A screen passes a destination id and the href, label and
glyph come from this registry. A screen under a TOOL is the exception — tools are not registry rows —
and is spelled out there (`FILE_WORKBENCH_BACK`), pinned to the manifest by a test.
