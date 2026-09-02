---
worktree: /home/user/magna-carta (remote session)
area: Directory linking — one picker/identity/parties family for every surface that names a person or organization, built first against the matter's parties and client
status: building
touches: docs/specs/2026-09-02-directory-linking-design.md, packages/design-system/src/lib/components/{entity-identity,entity-picker,record-parties}, tooling/lint-one-ui/registry.json, apps/web/src/lib/directory, apps/web/src/lib/matters, apps/web/src/routes/(app)/matters/[id]/parties, apps/web/src/routes/(app)/directory, roadmap.d/core-domain.md, roadmap.d/design-system.md, status.d/1-3-directory.md, changelog.d/
---

The design is [`docs/specs/2026-09-02-directory-linking-design.md`](../../specs/2026-09-02-directory-linking-design.md);
its §7 carries the owner's rulings of 2026-09-02. This note is the handoff between sessions: what has
landed on the branch, what was verified and how, and what the next session picks up first.

## Landed on the branch, pushed, not yet merged

**Slice 2 (the client is a party), commit after `6c45ef01` (the merge of main):** `createMatter`
in `packages/matters` takes `clientEntityId` and writes the `client` `matter_party` row in the same
batch (`clientPartyStatements`; `@magna-carta/matters` now depends on `@magna-carta/directory` for
the insert statement); `CreateMatterRequest.clientEntityId`, `MatterDetail.clientEntityId`,
`MatterSummary.clientEntityId` (one batched read per page); the never-called `client-migration.ts` backfill and its test are deleted on the owner's ruling
that there is nothing to back fill; the intake's client field is `EntityPicker`, the draft requires a client for open AND
prospective, `client-picker.svelte` and `knownClientNames` are deleted, "Open Client Record" is a
`Button href` link, "Run Conflict Check" runs a preliminary check on the client with one
always-mounted result line, and the overview's Client fact is an `EntityIdentity` link (the header's
citation stays one string by ruling). Route tests cover the party at create and the 422 on a bad handle. A design review's four must-fix items were fixed before the commit.

**Slice 1, commit `0fa125b2`:**

Slice 1 of the spec, whole: `EntityIdentity`, `EntityPicker`, `RecordParties` in the design system
with stories and package tests; `directory-picker-source.ts` as the one search adapter;
`party-api.ts` gained `linkMatterParty`, `PARTY_ROLE_OPTIONS` and `storedRoleFor`; the matter
Parties page on the tab, its hand-composed dialog and allowance gone; `/contacts` renamed to
`/directory` (route directory, `entityRecordHref`, the navigation destination whose id is now
`directory`, two tests, the palette comment); the app-local `entity-identity.svelte` deleted and its
five consumers pointed at the design-system mark; ledger nodes in `roadmap.d/core-domain.md`
corrected and `design-system.directory-linking` added; `status.d/1-3-directory.md` `ui:` in
progress; user guide `docs/user/features/matter-parties.md`; changelog fragment
`one-way-to-name-a-person-anywhere.md`; the family's rules in `packages/design-system/CLAUDE.md`.

**Verified:** `pnpm check:scoped` green (19 repo lints, fmt, lint, fitness sweep, tsc, both
svelte-checks); the family's unit tests and the CSS fitness gates (1049); the 21 story tests in
headless Chromium with axe. A design review against the standing rulings raised six must-fix items,
all fixed before the commit. **Not verified:** rendered pixels — nobody has looked at the screen.
Review it on the deployed site after merge (the matter's Parties tab, and `/directory`).

## Decisions taken while building, so they are not re-litigated

- **No party-role route.** `directory_party_role` has package functions but no HTTP route; slice 1
  offers roles from the client-side catalog in `party-api.ts` (the same keys every reader of
  `matter_party.role` normalizes to) plus a typed role through the add row, stored via
  `storedRoleFor`. The route lands with category management in slice 4.
- **The picker's `onCreate` seam exists and is unwired** — quick-create waits on the owner (§7 Q-4).
  A person not in the directory is created on `/directory` first.
- **Single mode shows the selection once:** the field names it, and one clear control (`Remove
<name>`) stands beside it. No chip beside the field (reviewer finding, spec §2.1 read that way).
- **What the listbox says rides as rows** (disabled `Combobox.Item` for a note, an enabled one for
  "Try Again"), because a listbox may hold only options and focus stays in the field.
- **A party the directory no longer resolves** arrives with `kind: null`; the mark draws a dashed
  glyph and a "Not in the directory" badge rather than guessing.
- **`RecordParty.href`** exists so a name that navigates wears the link register; `onOpen` is for a
  record window that opens it some other way.
- **The parties tab is a list of rows** mirroring the attachments tab, at a readable measure
  (`max-w-xl`) on the matter tab. The reviewer asked whether the 2026-08-31 grid ruling binds on a
  full-width tab instead; **open question for the owner**, not decided.
- **The destination id changed** from `contacts` to `directory`: a member's stored sidebar override
  for that one entry resets to the default (starred, canonical position). Accepted.
- **`requestJson` takes no abort signal**, so the adapter cannot forward the picker's; safe because
  the picker discards a late answer. Adding `signal` to `JsonRequest` is a one-line widening in
  `apps/web/src/lib/api/request.ts`, which the unified-error stream (in review) also touches.

## Known debts left standing, on purpose

- **Combobox wrapper axe findings** (not this family's files): with a listbox open, axe reports
  `aria-input-field-name` on the listbox and `aria-valid-attr-value` on the input's `aria-controls`
  (the Root-minted id lands on nothing; Bits puts its own id on the Viewport). Every picker story
  therefore ends with the listbox closed. Worth a fix in `combobox-content.svelte`.
- Reviewer nits not taken: the "Searching the directory" row is mounted already populated (`aria-live`
  seldom announces it); the role combobox's `as never` cast (the house Select pattern); the field
  label "Person or organization" is sentence case where some app labels are title case.
- The three hand-rolled pickers still stand (`conflicts/subject-party-picker.svelte`,
  `custodian/owner-picker.svelte`, `costs/cost-payee-picker.svelte`) and the custodian-local name
  resolver `custodian/directory-names.svelte.ts` — slice 3.

## Next session, in order

1. **Slice 2 is closed by the owner's rulings of 2026-09-02:** no backfill (deleted); the intake's
   two links open beside the draft through the one new-tab gate; the conflict check's hit-count
   colouring and quick-create (Q-4) wait for the owner's later, deeper pass over conflict checks and
   intake. Nothing in slice 2 is pending.
2. **Slice 3 is built for conflicts and costs** (commit after `d3c1b165`): the check runner
   (multiple mode), the disposition dialog and the cost record window pick through `EntityPicker`;
   the two copies are deleted; `apps/web/test/entity-picker-gate.test.ts` refuses any other
   `searchDirectory` caller outside `$lib/directory`. **Left standing on purpose:** the custodian's
   `owner-picker.svelte` and its name resolver `directory-names.svelte.ts`, because
   `custodian-refinements-19iycw` (in review) rewrites both `owner-picker.svelte` and
   `new-packet-dialog.svelte`. When that stream lands: fold the owner picker (two seats, `excluded`
   for the owners already chosen), promote the resolver to `$lib/directory/entity-names.svelte.ts`,
   and delete the allowance entry in the gate test — the test fails on its own if the copy is gone
   and the entry is not. The owner's direction of 2026-09-02: the conflicts UI is not built yet and
   will be aligned with intake later; where this work needs conflicts, build seams, not features.
3. Slices 4 and 5 per the spec.

## Environment notes for a fresh container

- `pnpm install`, then **`node tooling/bootstrap/index.mjs`** — `vp run bootstrap` is not a task
  name in this repo despite the root `CLAUDE.md`; the script is what builds the three WASM
  artefacts, and `pnpm check:scoped` refuses to run until they exist.
- After renaming or adding a route, run `pnpm --filter @magna-carta/web exec svelte-kit sync`
  before `svelte-check`, or `./$types` is reported missing.
- Story tests: from `packages/design-system`, `pnpm exec vp test run --project storybook
src/stories/<name>.stories.svelte`. The bundled Playwright wants Chromium headless-shell revision
  1223 and the container ships 1194; point `PLAYWRIGHT_BROWSERS_PATH` at a scratch directory that
  symlinks the 1194 binary under the 1223 name rather than running `playwright install`. Never run
  two vitest runs at once — the storybook project reloads and every story fails.
- Run the package's unit tests from `packages/design-system` (`pnpm exec vp test run --project
unit …`); from the repo root the project selection fails to start.
