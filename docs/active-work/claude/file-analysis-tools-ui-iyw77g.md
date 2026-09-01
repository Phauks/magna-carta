---
worktree: C:/dev/magna-carta-worktrees/claude/file-analysis-tools-ui-iyw77g
area: File Workbench — the owner's 2026-09-01 rulings on the screen's shape and its duplicated hash surface
status: building
touches: apps/web/src/lib/tools/file-workbench, packages/design-system/src/lib/components, docs/conventions/file-workbench-rulings.md, docs/conventions/design-corrections.md
---

Round-five corrections to the workbench. The screen's two sides become one container that touches
across a single divider, the file list keeps its own footer, the capability tabs move to the top
edge of the readings, and the list marks which file the readings are about. On the content side the
"Read by" / "Computed by" provenance rows come out, the readings stop nesting bordered tables inside
their own panel, the Convert tab loses its restatement of what a conversion is, and conversion
targets collapse to file types.

The one that reaches outside the workbench is the digest display: the file manager already had one,
so the second one built here is being replaced by a shared design-system component both surfaces
use. That means a new component under `packages/design-system/src/lib/components/`, so a concurrent
stream adding a component there should expect a neighbour, not a conflict.
