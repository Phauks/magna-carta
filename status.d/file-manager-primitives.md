---
slice: File-manager UI primitives (FileIcon · Breadcrumb)
group: cross-cutting
order: 22
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

`@magna-carta/design-system/file-icon` + `/breadcrumb` — file-type iconography (content-type/extension → Lucide glyph, folder variant, recipe-sized) and folder-path navigation (nav landmark, `aria-current` leaf, middle-collapse behind an ellipsis). Token-pure recipes; behaviour tests wrapped in named `step()` calls.
