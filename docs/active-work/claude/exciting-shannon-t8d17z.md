---
worktree: /home/user/magna-carta (remote session)
area: Staging ground for the owner's next rounds — the Upload dialog, the Settings surface and Conflicts; notes and research recorded, no code taken
status: review
touches: docs/conventions/file-manager-rulings.md, docs/conventions/settings-rulings.md, docs/conventions/conflicts-rulings.md, docs/conventions/matter-rulings.md, docs/conventions/magnus-rulings.md, docs/conventions/time-tab-rulings.md, docs/conventions/design-corrections.md
---

The owner is staging notes for further rounds on the matter file manager's Upload dialog, on the
Settings surface and on Conflicts, and has asked explicitly that no work start until they say so.
This stream has recorded the 2026-09-09 notes as `R22` in the file-manager rulings ledger and opened
`docs/conventions/settings-rulings.md`, `docs/conventions/conflicts-rulings.md` and
`docs/conventions/matter-rulings.md`, each with the owner's 2026-09-11 notes as its `R1`; added
`docs/conventions/magnus-rulings.md`; added `R12` to `docs/conventions/time-tab-rulings.md` for the
firm's money screens; recorded the messaging correction in
`docs/conventions/design-corrections.md`; and consolidated all of it there, where the per-surface
ledger index now lists every ledger, names the six staged rounds, and states the four themes they
share — every ruling row `open` — together with the research
each round will need, and has touched no application code. When the work starts it lands in
`apps/web/src/lib/file-manager/`, `apps/web/src/routes/(app)/settings/`,
`apps/web/src/lib/settings/`, `apps/web/src/lib/conflicts/`, `packages/conflicts/`,
`apps/web/src/lib/matters/numbering-scheme-editor.svelte` and two design-system floating surfaces,
with backend consequences in the duplicate-hash rows, in whatever Offices needs, and in the
conflicts engine's bounds.

**The registry is almost entirely dead notes, and this stream verified it rather than trusting it.**
Of the 55 notes in `docs/active-work/`, 48 name branches whose work has landed, two name workspace
branches holding no commits of their own, and two are legacy notes with no branch behind them. Only
five streams are actually live, and none of them touches anything staged here:
`custodian-refinements-19iycw`, `firm-usage-ui-surface-2zpcw6`, `passive-dev-orchestrator-m7f9jw`,
`tasks-feature-planning-ihaq2r`, and this one. Every note this staging would otherwise have had to
route around — `file-manager-breadcrumb-reflow-fu0pqp` (#567), `conflicts-check-ui-0i4kir` (#556),
`conflicts-check-redesign-w7pl40` (#575), `billing-uui-consolidation-5l2kiu` (#576) — is a dead note
owed a `vp run retire-note`. Each landing was established by walking `main` forward from the merge
base to the first commit that absorbs the branch without changing it, with branches contributing no
commits of their own excluded first, which is the rule `tooling/branch-landing/` implements.

## Handover — where the rounds stand, 2026-09-14

Written 2026-09-14 by the orchestrating session, because the session's budget ran out before the
last merges. Everything below is on branch `claude/exciting-shannon-t8d17z` or in a named agent
worktree under `.claude/worktrees/`. The per-surface ledgers hold every
ruling with its status, and `docs/conventions/design-corrections.md` ("Per-surface ledgers") indexes
them and the four themes the rounds share.

## What is on the stream branch, merged and gated

Each round below passed the pre-push scoped gate on the branch (fmt, repo-wide lints, incremental
tsc, svelte-check, the fitness sweep) and its own path-filtered tests. **No round was verified in a
browser except Agent I's** (Tools and Reports, screenshotted at 1440 and 820). Every visual claim
in the ledgers' "Notes recorded this round" blocks is from code.

| Agent | Round | Ledger | Result |
| --- | --- | --- | --- |
| E | The matter lifecycle and the seal | `matter-rulings.md` L1, L2 | A consultation closes or holds; the seal is a dropdown of the steps available from where the matter stands. W1 open. |
| C | The Upload dialog | `file-manager-rulings.md` R22 | Fixed frame, tabbed intake, "+ File / + Folder", per-file readiness from the hash, failure lines, duplicate setting gone, bytes survive until the last row naming them goes. |
| B1 | Settings consolidation | `settings-rulings.md` R1 | One page shape (`SettingsScrollRegion`, `SettingsPage` over a server draft), `ChoicePicker` for every closed choice, `DataTable.Grid` on the five settings tables, Versions as the chip's report, Beta Branch with the cancel fix, Core/Extended/Full with the engine beneath, Matter Numbering as a table. Then the Settings shell on `NavigationLayout`, and the picker re-pick fix (two causes). |
| A | Design-system foundations | settings G4/G5, file-manager A39 | `NavigationLayout` (snippets only; standard/narrow); every floating surface on the `anchored` layer; Select/Combobox/DropdownMenu/Popover default `align="end"` with width capped to the room. |
| F | Money screens and messaging | `time-tab-rulings.md` R12; design-corrections 2026-09-11 and 2026-09-14 | `ScreenSearch` live on all four, "+ Bill", column filters reaching the server (status as a list), no header line; messaging's tabs gone, "New Message", the History tab as the rail alone, the phone extension roll fixed. |
| H | Structured empty states | design-corrections 2026-09-14 | `lint:structured-empty` (registered, in the gate); `DefinitionList` with `Empty`; `EventRail` empty frame and `note`; `GridFigures` `scope: "whole-record"`; Hashes tab, bill History/Delivery, trust ceiling row, resource meters, speed-test panels fixed; `address-fields` re-pick fix. |
| D | Conflicts | `conflicts-rulings.md` R1, all 17 rows | Numbered checks (`CC-0001`), runs under a check with polled stage progress, relationships walked to closure under one platform ceiling, places with Directory's specifics behind a caret, name matching with examples, two-card check screen, Print/Download Report, File on a Matter, Run Again. Run executes via `waitUntil` after the 202 — not a queue yet; a run silent for two minutes is settled as failed. |
| G | Magnus | `magnus-rulings.md` R1, all 8 rows | Server-side sort (date/name/matter) with the control in the empty state, in-place rename, keep-on-a-matter as an access decision, file attachments by reference with per-file sent/cut/unreadable honesty, the model selector over the verified catalog (neither the Workers AI binding nor the AI Gateway enumerates models — confirmed against current docs), the workspace on `NavigationLayout`. |

Orchestrator commits between them: the lint-scope floor re-measured to 1.3 at the owner's direction
(`tooling/affected-lint/scope-fitness.mjs`, with the measured distribution recorded), the
upload-rulings harness updated to the new words, the matter header's create noun "Message", the
migration order for D's and G's tables (Magnus attachment at 8, conflicts numbers and runs at 9,
snapshot 9 regenerated by the lineage's refresh tool), the PII registry rows for every new table,
the conformance operation list, roadmap nodes and the register render.

## Merged after the handover was first written

Both remaining rounds are on the stream branch and pushed (2026-09-14, later the same day):
**Agent B2 — Offices and firm identity** (migration at slot ten, snapshot ten regenerated, the
`firm_brand_image` table classified as holding no person, settings rows F1/F2/O1 settled) and
**Agent I — Tools and Reports two-sided** (recorded on the 2026-09-11 ruling). `origin/main` was
also merged in, reconciling the upload rounds that landed on `main` during the week (name-clash
choices, the held file still filed, the readiness report as the version panel's fourth fold, the
per-version Hashes selector). The last pushes ran with the hook's own `SKIP_PREPUSH=1` at the
owner's instruction — the gate of record on the pull request is the verification that stands.

## Still to do after those

- **Matter W1** (`matter-rulings.md`): the status window's Physical File "Location" fact links to
  the office record through `OfficeLink` / `OfficePicker` from `$lib/offices` (both merged); the
  New Matter dialog's Location swaps `VocabularyPicker` for `OfficePicker`. Also B2's optional
  follow-through: `packages/document-assembly/src/resolve.ts` `resolveLetterheadLogo` taking the
  firm's primary brand image as the second source.
- **Agent I's follow-through**: `git mv apps/web/src/lib/tools/catalogue-navigation.{svelte,ts}` to
  `apps/web/src/lib/catalogue/` (two layout imports, the test imports, a line in that CLAUDE.md).
- **A `NavigationLayout` row part** (design system): the navigation-row treatment (control-height
  row, hover tint, current = selected surface + inset accent bar) now exists three times — the
  settings layout, Agent I's catalogue column, and inline in both. One `NavigationLayout.Row` or a
  `navigation-row` recipe.
- **Conflicts runs on a queue**: `apps/api-worker/src/conflicts/check-run-executor.ts` is one
  function a consumer can call; one dispatch entry makes execution durable and removes the
  two-minute heartbeat settlement. `new-matter-dialog.svelte` still runs its check synchronously
  through the compatibility helper.
- **Ledger formatting**: `pnpm fix:scoped` reformats the hand-padded tables in the four staged
  ledgers (`conflicts-`, `magnus-`, `matter-`, `settings-rulings.md`); run it once on the merged
  branch and commit the result, or every later diff pass re-touches them.
- **The whole-repo gate**: no full `pnpm check` + `pnpm test` was run on the merged branch (the
  session ran the scoped gate per push and path-filtered tests per round). The gate of record on
  the pull request is what settles it; the `run-tests` label asks for the test battery.
- **Browser review**: every agent listed what the owner should look at first on the deployed site;
  the lists are in each agent's ledger notes. The `narrow` NavigationLayout width (256px) is
  narrower than Magnus's previous 288px rail and is the one width call flagged for a look.
- **Ambiguities the owner has not settled** (decided by the orchestrator, recorded in the ledgers):
  the money screens' "text under the header" was read as the header meta line (removed) and not
  the partial-total caveat under Load-more on the matter tabs (kept); firm branding is firm-wide
  with the per-office letterhead falling back to it; the scan tiers' rule detail is on File
  Safety beneath the engine reading, with the rule families a Soon seam because the repo documents
  none; the model roster is the catalog, stated with its date.

## Worktrees to retire

`git worktree list` shows the ten agent worktrees under `.claude/worktrees/`. Every agent branch
has landed on the stream branch and the worktrees can go
(`git worktree remove <path>`; the branches are local only, never pushed).
