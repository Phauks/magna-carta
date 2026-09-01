# Consolidated modal architecture — analysis and design

**Date:** 2026-09-01
**Status:** Proposed. Analysis complete; the contract in section 5 and the sequencing in section 8
are for the owner to accept. Not built.
**Scope:** Every modal panel in `apps/web` that is not a record window — thirty-four files, thirty
composing `Dialog.Content` by hand and four composing `AlertDialog.Content` — and the one shell they
should be composed from instead.
**Excludes:** `RecordWindow` itself, which is the settled answer for reading and changing a record
and is not reopened here; the `Dialog` / `AlertDialog` / `Sheet` primitives, which stay exactly as
they are and are what the new shell is built from; and the failure model, which
[`2026-08-31-unified-error-surface-design.md`](2026-08-31-unified-error-surface-design.md) owns.

**Binding inputs:** golden rules 1 (reuse before building) and 2 (all UI through the design system)
in [`../../CLAUDE.md`](../../CLAUDE.md); the one-implementation doctrine already enforced by
`tooling/lint-one-ui`; `RecordWindow`'s own contract
(`packages/design-system/src/lib/components/record-window/`), which this design deliberately
copies rather than reinvents; the owner's standing rulings in
[`../conventions/design-corrections.md`](../conventions/design-corrections.md) — no dead controls,
a refusal is stated where it is caused, error copy is per-channel and specific.

---

## 1. The finding in one paragraph

The product already decided that a shared surface is built once: `RecordWindow` is the one window a
record opens in, `RecordMenu` is the one menu a table right-clicks into, and `tooling/lint-one-ui`
fails the build when a second implementation of either appears. That doctrine was never extended to
the modal that asks somebody to _do_ something, and the gap is now the largest duplication in the
app. Thirty files in `apps/web` compose `Dialog.Root` and `Dialog.Content` by hand — 7,753 lines —
and each one re-derives the same seven mechanics: the open flag, the reset when it opens, the busy
flag, the commit, the failure band, the refusal that disables the commit, and the footer. They
disagree already: thirteen say "Cancel" and five say "Close" for the identical gesture, eighteen
suppress the corner dismiss and twelve keep it, five still render a raw `Alert` where nineteen
render `FailureNotice`. **And not one of the thirty guards its dismissal** — every one of them
throws away a half-written write-off, credit note or new matter when Escape is pressed, silently,
which is the precise failure `RecordWindow` was given a guard to prevent. The rate is not slowing: two
branches opened this week added four more hand-composed panels between them, one of which renders
its failure through the very `Alert` that a cross-cutting sweep merged days ago to remove — and that
sweep, having thirty independent panels to reach, left five of them still doing it. Adding the modal
peer of `RecordWindow` now costs one component and one lint rule; every week it is not added costs
another two panels and widens the migration.

## 2. What is built, and where it stops

| Layer                                                                            | State                                                                                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Dialog` / `AlertDialog` / `Sheet` primitives (portal, scrim, presence, z-layer) | **Built and good** — `packages/design-system/src/lib/components/dialog/`, thin over Bits UI, token-only recipes                |
| The window a record is read and changed in                                       | **Built** — `RecordWindow`: domain-blind, one header set, one action bar, one close guard, registered in `lint-one-ui`         |
| The panel an **act** is asked for in                                             | **Never built.** Thirty files each assemble one, at 30 call sites                                                              |
| The question a dismissal asks when there is unsaved work                         | **Built once, for records only** — the guard is private to `record-window.svelte`; no dialog can reach it                      |
| Which verb dismisses a panel, and whether the corner dismiss shows               | **Unsettled** — decided per file, and the files disagree                                                                       |
| Enforcement that a second panel is not written                                   | **Absent.** `lint-one-ui` catches a raw `<dialog>` and a hand-built scrim; a hand-composed `Dialog.Content` is invisible to it |

## 3. The evidence

Thirty files under `apps/web/src` compose `Dialog.Content` directly and are not `RecordWindow`
callers; four more compose `AlertDialog.Content` and are the product's only confirmations. The table
below counts the thirty, which are where the scaffold lives — the four confirmations carry a smaller
one and are dealt with in section 5.2, item 6. Across those thirty:

| Mechanic each panel re-derives                                | Files | What the shell would do instead                                 |
| ------------------------------------------------------------- | ----: | --------------------------------------------------------------- |
| Own a bindable `open`                                         |    25 | Shell owns it, and owns the transitions off it                  |
| Reset their fields in an `$effect` keyed on `open`            |    12 | One `onOpen` callback, fired once per opening                   |
| Own a `working` / `submitting` / `saving` flag                |    19 | Shell sets it around `onCommit` and hands it to the fields      |
| Render `FailureNotice`                                        |    19 | Shell places it; the caller still supplies the words            |
| Render a raw `Alert` for the same failure                     |     5 | Closed off — the notice slot is the only place a failure lands  |
| Derive a refusal that disables the commit                     |    14 | Shell disables and titles the control from one `commitRefusal`  |
| Hand-build the footer row (`flex justify-end gap-8`)          |    25 | Shell owns the bar's geometry and the order of its two controls |
| Choose whether the corner dismiss shows (`showClose={false}`) |    18 | Decided once, by kind                                           |
| **Guard Escape or a press outside against unsaved work**      | **0** | One guard, shared with `RecordWindow`                           |
| Manage focus on open or close                                 |     2 | Shell's default; a caller may still name the field to land on   |

The dismissal verb: thirteen panels say **Cancel**, five say **Close**, for the same gesture.

Four panels written this week, on two different branches, show the rate:
`claude/custodian-refinements-19iycw` adds three (`new-packet-dialog`, `add-item-dialog`,
`link-scan-dialog`) and `claude/matter-status-modal-wjzv1v` adds one
(`matter-status-dialog.svelte`). All four re-derive the scaffold. The fourth renders its failure
through `Alert.Root variant="danger"` — the construct the unified failure surface landed to remove,
which that branch has not synced. Nothing in the repository told either author the other existed,
because nothing in the repository holds the answer.

**And the sweep that just landed shows what a per-file migration leaves behind.** The unified
failure surface reached most of these panels and merged; five still render a failure in a raw
`Alert`, and two of those five (`diagnostics/report-dialog.svelte`,
`file-manager/folder-delete-dialog.svelte`) take their failure as a bare `string | null` from the
caller — so the problem was flattened before it arrived and `pnpm run lint:failure-surface`, which
watches catch sites, passes over it. That residue is not a criticism of that branch; it is what
thirty independent panels cost a cross-cutting change. A shell would have had one place to reach.

## 4. What the merge window says about this

Sequencing matters more than the design here, so it is stated before the design rather than after.

**A note on how this was read, because it changed the answer.** Asked with `git rev-list --count`,
four of these branches look wide open — twenty-one, thirty-three, ten and two commits ahead of
`main`. They have all landed. This repository squash-merges, so ahead/behind says nothing about
delivery, exactly as [`../../CLAUDE.md`](../../CLAUDE.md) warns; the question is answered by
`tooling/branch-landing/`, which walks `main` forward to the commit each branch merges into without
changing, and by `vp run worktrees`, which prints the same answer and names the notes to retire.
Both were run. Sequencing this design against the naive reading would have deferred half of it
behind branches that shipped days ago.

| Branch                                       | State                         | Bearing on this work                                                                                                                                                      |
| -------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `claude/unified-error-screen-8pam6s`         | **Landed**                    | Its `FailureNotice` is what the shell's notice slot is designed around. Nothing waits on it; the five panels it did not reach are section 3's residue                     |
| `claude/focused-cori-b8z77b`                 | **Landed**                    | Releases `record-window.svelte`, `new-matter-dialog.svelte`, `reclassify-dialog.svelte` and `arrangement-dialog.svelte`. **This is what unblocks the shared close guard** |
| `claude/magna-carta-file-manager-mdnug5`     | **Landed**                    | Also released `record-window.svelte` and `upload-destination-dialog.svelte`                                                                                               |
| `claude/table-columns-right-click-c15j6y`    | **Landed**                    | Not a modal change, but the precedent this plan copies: one component, twelve call sites, every per-surface copy deleted in the same pass                                 |
| `claude/custodian-refinements-19iycw`        | In flight, 2 ahead / 0 behind | **The best first adopter.** Three panels, all new files, so adoption is a rewrite rather than a migration, and it conflicts with nobody                                   |
| `claude/matter-status-modal-wjzv1v`          | In flight, 9 / 12             | Second adopter, same reason. It is twelve behind, and its raw-`Alert` failure should become the notice slot when it syncs                                                 |
| `claude/matters-notes-section-m9na1w` (#464) | In flight, 1 / 6              | Nothing to do — it moves the note onto `RecordWindow`, which is this design's own argument, one record kind early                                                         |
| `claude/firm-usage-ui-surface-2zpcw6`        | In flight                     | Touches the app shell and the download tray, no modal panel. No overlap                                                                                                   |

Three conclusions the plan in section 8 is built on.

1. **Nothing blocks any part of this.** Every branch that held a file this design touches has
   merged. `record-window.svelte` is free, so the close guard is extracted and shared in the shell's
   first commit rather than written twice and reconciled later — the compromise the naive reading of
   the window would have forced, for nothing.
2. **The only live modal work is the two adopter branches**, and both are adding new panels rather
   than editing old ones. They are the cheapest possible proof of the contract, and they are
   already writing the code the shell would replace.
3. **The migration is unusually safe right now.** Twenty-six panels, no branch holding any of them,
   and a landed cross-cutting sweep to migrate them _onto_ rather than around. This window closes
   the moment the next branch opens one of the twenty-six.

## 5. The design

**One shell: `ActionDialog`. It is the modal peer of `RecordWindow`, and it is built the same way,
on purpose.** A record opens in `RecordWindow`; an act is asked for in `ActionDialog`. Between them
they are every modal surface the product has, and a reader learns two panels instead of thirty.

The shell is a single component with no composable parts, exactly as `RecordWindow` is — the
namespace shape exists so a caller can assemble a component's parts, and this one deliberately has
none to assemble. Home: `packages/design-system/src/lib/components/action-dialog/`, exported at
`@magna-carta/design-system/action-dialog`.

### 5.1 The contract

```ts
/** What is being asked. It decides the primitive, the tone of the commit, and the dismissal verb. */
export type ActionDialogKind = "form" | "confirm" | "destructive";

/** How the commit went. The shell closes on one and stays open on the other. */
export type ActionOutcome = "committed" | "refused";

interface ActionDialogProps {
  /** Showing or not. Bindable, so a surface opens and closes it. */
  open: boolean;

  /**
   * What is being asked. "form" carries fields and dismisses on Escape and on a press outside;
   * "confirm" and "destructive" carry none, render as AlertDialog, and dismiss on Escape alone —
   * a question that can be dismissed by a stray press is not a question.
   */
  kind?: ActionDialogKind;

  /** The act, in the reader's words. Never a noun phrase for the panel ("Write Off a Balance"). */
  heading: string;

  /** What is being acted on, named once. The record's reference belongs here and only here. */
  subtitle?: Snippet;

  /**
   * The body. Handed `busy` so one snippet renders the fields at rest and while the commit is in
   * flight — two snippets would be two layouts, and they would disagree within a week.
   */
  fields?: Snippet<[{ busy: boolean }]>;

  /**
   * The failure band's PLACE, which is the shell's; its CONTENT, which is the caller's. The design
   * system cannot know what a failure reads like — that is `FailureNotice` in the app — so the
   * shell reserves the slot directly beneath the subtitle and renders whatever arrives in it.
   * This is the `menu` precedent from RecordWindow, and it is the seam that keeps the shell
   * failure-blind without letting thirty callers each choose where a failure sits.
   */
  notice?: Snippet;

  /** The commit's own verb — "Write Off a Balance", never "OK", "Submit" or "Confirm". */
  commitLabel: string;

  /**
   * Why the commit is unavailable, if it is. The control is DISABLED and titled with this rather
   * than hidden: an act that vanishes teaches a reader nothing, and a refusal is stated where it
   * is caused. Undefined means the commit is available.
   */
  commitRefusal?: string;

  /**
   * Do it. The shell raises `busy`, awaits, and lowers it. "committed" closes the panel;
   * "refused" leaves it open with whatever the caller has put in the notice slot. The caller
   * never touches `open` on the way out, which is what makes the close path one path.
   */
  onCommit: () => Promise<ActionOutcome>;

  /** Fired once each time the panel opens. Where a caller clears its fields. */
  onOpen?: () => void;

  /** Fired after any dismissal that was not a commit, once the guard has allowed it. */
  onDismiss?: () => void;

  /**
   * Whether there is anything to lose. `true` (the default) makes every exit — the corner dismiss,
   * Escape, a press outside — ask before discarding. A caller that can see its fields are
   * untouched sets it false and the question is skipped. The default is the safe one because a
   * caller that forgot to think about it should get the question, not the silence.
   */
  unsavedChanges?: boolean;

  /** The field to land on when it opens. Defaults to the first focusable thing in `fields`. */
  autoFocus?: string;

  /** How wide. A closed set, not a class: `narrow | default | wide | record`. */
  width?: ActionDialogWidth;
}
```

### 5.2 What the shell owns, and no caller may re-derive

Ownership is the whole point, so it is enumerated. These are not defaults a caller can override —
there is no prop for them, which is what makes them true everywhere:

1. **The footer.** Its geometry, its two controls, and their order: the dismissal at the weak hand,
   the commit last at the strong hand, always. A caller supplies two words (`commitLabel`, and the
   dismissal's word only through `kind`) and nothing else.
2. **The dismissal verb.** **Cancel** on a `form` — it abandons something begun. **Never mind** on a
   `confirm` — nothing was begun. This settles the thirteen-to-five split by deciding it once, and
   it is question 1 in section 10 if the owner wants different words.
3. **The busy state.** Raised around `onCommit`, lowered after, threaded into `fields` and onto both
   footer controls. Nineteen panels currently own a flag; none would.
4. **The close path.** One function, run by the corner dismiss, Escape, and a press outside alike,
   and it consults `unsavedChanges` before any of them. A second exit that skipped the question
   would make the question decorative — the reasoning is already written in `record-window.svelte`
   and this is that reasoning applied to the thirty panels that never got it.
5. **The corner dismiss.** Shown on `form`, absent on `confirm` and `destructive` — a question is
   answered, not dismissed. The `showClose` prop does not exist on this shell.
6. **The primitive.** `Dialog` under a `form`, `AlertDialog` under a `confirm` or `destructive`. The
   caller declares what it is asking; the shell decides which role, which dismissal behaviour and
   which focus default that implies. **This is the single most valuable line in the contract**: it is
   the reason four panels reach `AlertDialog` today and thirty do not with no rule behind the split
   — a void, a delete and a party removal are on it; a void-draft, a folder delete and a file
   restore, which are the same question, are not.

### 5.3 The seams, and why each is a seam and not a prop

Modularity here means a small closed set of places a caller may differ, and no others:

- **`fields` (a snippet, handed `busy`)** — the caller's whole body. Unbounded on purpose: this is
  where a domain lives, and the shell renders it without reading it.
- **`notice` (a snippet)** — the app injects `FailureNotice`. The shell stays failure-blind, so
  `packages/design-system` never learns about `$lib/api/problem.ts` and the dependency arrow keeps
  pointing one way. The next time how a failure reads changes, it changes one component and no
  panels — which is exactly what the sweep that just landed could not do.
- **`kind` (a closed union)** — the only way to reach a different primitive, tone or dismissal verb.
  Closed, so a fourth kind is a reviewed change to this file rather than a call site's improvisation.
- **`width` (a closed union)** — `narrow | default | wide | record`, each fed by the token that
  already backs it (`record` is `max-w-record-window`, so a create panel and the window it becomes
  are the same width). A closed set rather than a `class` prop, because the four widths in use today
  arrived as five different hand-written utilities.
- **`onCommit` returning an outcome** — the caller owns the request, the idempotency key and the
  words of its failure; the shell owns everything the outcome implies.

Deliberately **not** seams: the footer's layout, the button variants, the heading's typography, the
scrim, the presence, the z-layer, the focus trap, the scroll lock. A `class` prop is not offered.

### 5.4 The close guard, shared with RecordWindow

The guard `record-window.svelte` already implements — `pendingGesture`, `requestClose`,
`discardAndContinue`, and the "Discard Your Changes?" `AlertDialog` — is the thing all thirty panels
lack. It is lifted to `packages/design-system/src/lib/internal/close-guard.svelte.ts` plus a
`DiscardQuestion` component, and **both** shells consume it. One question, one wording, one
behaviour, for every modal surface in the product.

Sequencing (section 4): both branches that held `record-window.svelte` open have landed, so the
extraction happens in the shell's own first commit rather than being duplicated and reconciled
afterwards. It is behaviour-preserving on the record side by construction — the same code moved —
and `RecordWindow`'s existing tests are the proof, unedited.

### 5.5 What this deliberately does not absorb

A shell that swallowed these would be the wrong shell, and saying so up front is what keeps it from
growing into one:

- **`RecordWindow` callers** (fee, cost, time, conflict hit, packet, invoice, and the note now
  landing on #464). Already right.
- **`command-palette.svelte`** — a launcher, not an act. It is `Command` in a dialog and stays that.
- **`cost-review-window.svelte` and `safe-browse/website-shell.svelte`** — screens that happen to be
  presented over the app rather than acts asked of a reader (`time-sheet.svelte` is the same family,
  already counted elsewhere as a `RecordWindow` caller). They belong to a full-screen presentation
  question this design does not answer, and question 4 in section 10 asks whether it should be.
- **`directory/*-pane.svelte`** (four files) — panes inside a surface, not modals of their own.
- **`new-matter-dialog.svelte`** (647 lines, already reaching for `max-w-record-window` by hand) —
  it is a record being created, and its right answer is `RecordWindow` opened with `editing` raised,
  which that component already supports. Migrating it into `ActionDialog` would be the wrong shell,
  which is why it is named here rather than left to be discovered mid-migration.

That leaves **twenty-six** panels as `ActionDialog`'s real population: the twenty-two remaining
`Dialog` panels — ten in billing, one in costs, three in the file manager, two in the directory, and
one each in bug reporting, conflicts, diagnostics, documents, records and settings — plus all four
`AlertDialog` confirmations, which are the shell's `confirm` and `destructive` kinds and need the
least work of any of them. That is the number section 8 plans against, not thirty-four.

## 6. How a future branch uses it

The whole test of this design is whether the next branch reaches for it without being told twice.
`new-packet-dialog.svelte` (320 lines on `claude/custodian-refinements-19iycw`) becomes:

```svelte
<ActionDialog
  bind:open
  heading="Open a Packet"
  commitLabel="Open the Packet"
  commitRefusal={refusal}
  width="wide"
  unsavedChanges={name !== "" || items.length > 0}
  onOpen={reset}
  onCommit={createPacket}
>
  {#snippet subtitle()}This matter, {matterNumber}{/snippet}
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice failure={failure.failure} title="No Packet Was Opened" fallback={failure.fallback} />
    {/if}
  {/snippet}
  {#snippet fields({ busy })}
    <!-- the packet's own fields, and nothing else -->
  {/snippet}
</ActionDialog>
```

Everything above the fields is declaration. There is no `$effect`, no `working` flag, no footer, no
`showClose`, no decision about Escape — and the guard the file could not have written is present.
Measured across the twenty-two `Dialog` panels, the scaffold each carries runs 40–70 lines; what
replaces it is the eight above.

## 7. Enforcement

A convention nobody can violate is a convention nobody has to remember, and this repository already
has the machine for it.

1. **Register the name.** `ActionDialog` goes into `tooling/lint-one-ui/registry.json` with its
   home, and — per that file's own rule — **the moment the contract is accepted, not once it is
   built**, marked `pending` until the home lands. That is what stops a second branch from taking
   the name in the meantime, which is the failure mode section 3 documents.
2. **One new rule, `hand-composed-modal`.** A `.svelte` file under `apps/web/src` that renders
   `<Dialog.Content` or `<AlertDialog.Content` is a violation unless it is `ActionDialog`'s home,
   `RecordWindow`'s, or carries an allowance. It sits beside `findHandBuiltDialogs` in
   `tooling/lint-one-ui/rules.mjs`, which already makes exactly this argument about raw `<dialog>`
   and hand-built scrims and simply never reached one composed from the design system's own parts.
3. **All thirty-four go on the allowance list on day one, each with its reason.** The list is
   printed on every run, and `registry.json`'s discipline is that an allowance whose violation is gone
   is itself a failure — so a migrated panel must delete its line in the same commit, and the debt
   can only shrink. New work is bitten immediately; nothing in flight is blocked.
4. **A gallery, not a mockup.** `/developer-console/action-dialog`, beside the `record-window`
   gallery, showing all three kinds, all four widths, busy, refused, and the discard question —
   the states real data cannot reach, in the code that ships.

## 8. Order of work

Each step lands on its own and leaves the app working. Nothing here waits on another branch —
section 4 is why.

|   # | Step                                                                                                      | Notes                                                                       |
| --: | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
|   1 | Register `ActionDialog` in `lint-one-ui` as `pending`                                                     | Owner accepting section 5. Takes the name before another branch does        |
|   2 | Lift the close guard out of `record-window.svelte` into the shared internal, `RecordWindow` still passing | Mechanical, behaviour-preserving, and no longer blocked                     |
|   3 | Build the shell on that guard: recipe, gallery, tests. No adopters                                        | Its directory is new; conflicts with nothing                                |
|   4 | Adopt in `claude/custodian-refinements-19iycw` (3 panels) and `claude/matter-status-modal-wjzv1v` (1)     | New files — a rewrite, not a migration. Proves the contract before it binds |
|   5 | Add the `hand-composed-modal` rule with all thirty-four allowed                                           | Ships with adopters behind it, so the rule is asserting something true      |
|   6 | Migrate the eleven billing and costs panels, deleting their allowances                                    | The largest and most uniform family; sets the pattern for the rest          |
|   7 | Migrate the remaining fifteen, deleting their allowances                                                  | The four `AlertDialog` confirmations are the cheapest and should go first   |
|   8 | Move `new-matter-dialog.svelte` onto `RecordWindow` with `editing` raised                                 | The wrong shell today, and 647 lines. Owner question 3                      |

The order has one real dependency and it is step 2 before step 3: building the shell first would
mean writing the guard twice and reconciling two copies of a question the product asks in one
voice. Everything after step 5 is independently landable, one family at a time.

## 9. Test plan

- **Component tests** (`packages/design-system/test/action-dialog.test.ts`): the commit is disabled
  and titled when `commitRefusal` is set; `busy` is raised across `onCommit` and reaches both footer
  controls; `"refused"` leaves the panel open and `"committed"` closes it; `onOpen` fires once per
  opening and not on a re-render; each of the three exits runs the guard when `unsavedChanges`, and
  none when not; `kind` selects the primitive, and `confirm` renders no corner dismiss.
- **Fitness function** (`tooling/lint-one-ui/index.test.mjs`): the new rule flags a composed
  `Dialog.Content` under `apps/web`, honours an allowance, and fails an allowance whose violation
  has gone — the last is what makes the ledger shrink rather than rot.
- **Gallery test** (`apps/web/test/action-dialog-gallery.test.ts`), on the
  `record-window-gallery.test.ts` precedent: every kind × width × state renders.
- **Visual regression:** one story per kind, through the pinned Playwright container.
- **Migration:** each migrated panel keeps its existing tests unchanged. A panel whose tests need
  editing to pass has had its behaviour changed, and that is the signal to stop and look.

## 10. Open questions for the owner

1. **The dismissal verbs.** Proposed: **Cancel** on a form, **Never mind** on a question. Today's
   split is thirteen "Cancel" to five "Close" with no rule behind it.
2. **Does the corner dismiss survive at all on a form?** Eighteen of thirty already suppress it,
   which is close enough to a decision that it may be worth making one — a footer that already
   carries Cancel arguably does not need a second dismissal in the corner.
3. **`new-matter-dialog.svelte` onto `RecordWindow`** (step 8). It is the right shell and it is a
   647-line change to a file two branches hold; worth confirming before it is scheduled.
4. **The full-screen family** — `time-sheet`, `cost-review-window`, `safe-browse/website-shell`.
   Section 5.5 leaves them alone deliberately. If they should be one presentation too, that is a
   second design, and this one should not quietly grow into it.
