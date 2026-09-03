---
worktree: C:/dev/magna-carta-worktrees/claude/component-consolidation-review-j23x9o
area: Component consolidation — the details panel, the display vocabulary, the caps label register, the registry's reach, and two smaller repeats
status: building
touches: apps/web/src/lib/details-panel, apps/web/src/lib/time, apps/web/src/lib/costs, apps/web/src/lib/billing, apps/web/src/lib/matters/time-api.ts, apps/web/src/lib/matters/tasks-api.ts, packages/design-system/src/lib/formatters, packages/design-system/src/lib/components/data-table/typed-columns.ts, packages/design-system/src/lib/components/field-label, tooling/lint-one-ui/registry.json, changelog.d/
---

# component-consolidation-review

An audit of what the platform builds more than once, and the consolidation of what it found.
Verified first against the gates that already exist (`lint:one-ui`, `lint:matter-search-coverage`,
`lint:list-pagination`, `lint:failure-surface`): the one table, the modal shells, the matter's
search and the page masthead are genuinely single-homed and enforced. What follows is what is not.

**In scope, and what each collides with:**

- **`DetailsPanel`** — `time-`, `cost-`, `fee-` and `bill-details-panel.svelte` are four copies of
  one shell, down to identical class strings. The new home is `apps/web/src/lib/details-panel/`.
  This is the stream's largest collision surface: `magna-carta-timesheet-ui-uekeer` is building in
  `apps/web/src/lib/time` and `table-columns-right-click-c15j6y` names `time`, `costs` and
  `file-manager`. Coordinate before touching the four panel files.
- **The display vocabulary** — money, dates and durations had three homes and four answers. The
  work lands in `packages/design-system/src/lib/formatters/` and changes
  `data-table/typed-columns.ts`, which `custodian-refinements-19iycw`,
  `magna-carta-timesheet-ui-uekeer` and `table-columns-right-click-c15j6y` all name. The change
  there is small and additive-by-delegation: the two exported names keep their signatures.
- **The caps field label** — 62 hand-written spans across the app, in two disagreeing tones, none
  of them wearing the caps tracking every design-system recipe uses. The register itself is not a
  new ruling: `.mc-masthead-eyebrow` and `.mc-eyebrow-link` already agree on it, and the new
  `FieldLabel` component simply stops it being retyped.
- **`tooling/lint-one-ui/registry.json`** — entries added for the shared surfaces the registry did
  not yet name. An append to the `components` array, so the three streams that also touch this file
  (`calendar-ui-plan-eu523y`, `directory-ui-person-linking-fcot46`, `r2-bucket-isolation-review-pckokv`)
  merge around it.

**Deliberately not touched**, each being another stream's:

- `ScreenSearch` adoption and the three screens that hand-roll a search box.
- `BackLink` and the return affordance — which is also why it is absent from the registry entries
  added here.
- The undo/redo stacks (`MoveHistory`, `SheetHistory`) and their controls.
- `WipLedgerSurface`, the parameterized ledger template. It is the largest remaining repeat and it
  is deferred by the owner: it rewrites four shipped surfaces at once while three streams are live
  in them.
