# file-manager-primitives

**Scope:** The five design-system components a matter Files surface needs and the design system does
not have. `packages/design-system` only — this stream does not touch `apps/web` or the Worker.

Design: [`docs/specs/2026-07-09-matter-file-manager-design.md`](../specs/2026-07-09-matter-file-manager-design.md)

## What this stream builds

- `Dropzone` — the drag-and-drop upload surface, over the existing `FileInput` primitive.
- `Breadcrumb` — folder path navigation.
- `Tree` — the folder tree, with full keyboard semantics.
- `ContextMenu` — right-click row actions (Bits UI; a sibling of the existing `DropdownMenu`).
- `FileIcon` — per-file-type iconography, Lucide deep imports only.

Each ships with a Storybook entry, `play`-function behaviour tests, and visual-regression baselines.

## Files expected to be touched

- `packages/design-system/src/lib/components/{dropzone,breadcrumb,tree,context-menu,file-icon}/`
- `packages/design-system/src/lib/components.css` — token-only recipes, no escape valve
- `packages/design-system/src/stories/*.stories.svelte`
- `packages/design-system/visual-regression/` baselines
- `changelog.d/`, `status.d/` fragments

## Overlaps

`components.css` and the package index are shared with any other design-system stream. None is
currently in flight. Sync `main` before touching them.
