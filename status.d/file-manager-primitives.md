---
slice: File-manager UI primitives (FileIcon · Breadcrumb · ContextMenu · Tree · Dropzone)
group: cross-cutting
order: 24
research: n/a
spec: n/a
plan: n/a
built: done by="Opus 4.8" gap
ui: done by="Opus 4.8" gap
load-profile: n/a
tested: in-progress by="Opus 4.8" gap
branch: file-manager-primitives
active-work:
next: Container VRT baselines (Docker unavailable locally — land via CI); NVDA pass; owner Storybook sign-off
link-spec:
link-plan:
adrs:
blocked-by:
---

`@magna-carta/design-system/file-icon` + `/breadcrumb` — file-type iconography (content-type/extension → Lucide glyph, folder variant, recipe-sized) and folder-path navigation (nav landmark, `aria-current` leaf, middle-collapse behind an ellipsis). `/context-menu` — the right-click sibling of DropdownMenu over the Bits UI ContextMenu primitive (same part shape, floating presence, and recipe look). `/tree` — a folder tree with the full WAI-ARIA tree view keyboard model (roving tabindex, arrows to expand/collapse/descend/ascend, Home/End, typeahead), built without a Bits primitive because bits-ui 2.18.1 ships none; expansion is a bindable controlled set. `/dropzone` — the drag-and-drop upload surface over the FileInput primitive (drag-over state, drop forwarded to the consumer, keyboard/SR-operable through the underlying input, rejects nothing). Token-pure recipes; behaviour tests wrapped in named `step()` calls, including explicit Tree keyboard coverage and Dropzone drag/drop.
