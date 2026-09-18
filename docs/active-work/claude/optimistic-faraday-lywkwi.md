---
worktree: /home/user/magna-carta (remote session)
area: The /documents crash — the create control's noun budget, the token width behind it, and the two gates that now read a noun before it renders
status: review
touches: packages/design-tokens/tokens/primitives/dimension.json, packages/design-tokens/generated/, packages/design-tokens/test/golden/, packages/design-system/src/lib/components/create-control/, packages/design-system/test/create-control.test.ts, tooling/lint-matter-create-control/, apps/web/test/documents-library-screen.test.ts, docs/conventions/design-corrections.md
---

The template library answered every visit with the crash screen from the moment it shipped.
`CreateControl` refuses a noun longer than its fixed width holds and does it by throwing, which
happens while the screen renders, so the render boundary replaced the whole page — a label one
character too long read as a 500.

The owner's ruling was to re-measure the one width rather than rename the record: `size.create-control`
is 140px and the noun budget is eight, so "New Template" fits and every create control in the product
moves together. Anything touching the create control, the dimension primitives or their golden files
collides with this stream.

The rest is the reason it reached production. `pnpm run lint:matter-create-control` read create
nouns only out of the matter section registry, where they are data, and never out of a screen's
markup, where this one was written; it reads both now. `apps/web/test/documents-library-screen.test.ts`
mounts the screen under the real root layout, so the next render-time throw on it fails in the
battery instead of on the deployed site.
