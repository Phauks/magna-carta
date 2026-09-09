---
worktree: C:/dev/magna-carta-worktrees/claude/busy-sagan-uem32y
area: The New Check panel — two panes, plainer names, a derived trigger — and the one-scrollbar gate
status: review
touches: apps/web/src/lib/conflicts, apps/web/src/routes/(app)/settings/conflicts, apps/web/src/routes/(app)/matters/[id]/conflicts, packages/design-system/src/lib/components/action-dialog, packages/design-system/src/lib/components/record-window, packages/design-system/src/lib/components/dialog, packages/design-system/src/lib/components/alert-dialog, packages/design-system/src/lib/components/sheet, tooling/lint-scrollbar, package.json, vite.config.ts, docs/conventions/design-corrections.md, docs/user/features/conflicts-reports.md, changelog.d
---

The owner's review of the New Check panel, 2026-09-08. The panel becomes two panes on the frame's
context pane — the parties and where the check is filed on the left, the engine's settings on the
right — and every setting on the right gains a name a reader can act on and a line under it saying
what it searches. The trigger choice goes: preliminary and comprehensive name when a check ran, not
how it searched, so it is derived from whether the firm has taken the matter on. `check-form.svelte`
is replaced by `check-subject.svelte` + `check-scope.svelte` over one draft
(`check-draft.svelte.ts`), with the composition and the read-back in `check-request.ts`.

The same round adds the **one-scrollbar gate**: `tooling/lint-scrollbar` fails any element that can
scroll and does not name `mc-scrollbar` (or `mc-scrollbar-hidden`), deriving "can scroll" from the
Tailwind utilities AND from the design system's own stylesheets. Nineteen app regions and seven
design-system components were wearing the operating system's scrollbar, the ActionDialog's own
fields pane among them — which is where the owner saw it.

Do not step on `apps/web/src/lib/conflicts/conflicts-vocabulary.ts` (source, strictness and edge
class labels all move, and the log's columns and the printed report read them), or on the four
design-system panel shells above.
