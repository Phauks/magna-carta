# Consolidated modal architecture — analysis and design

**Date:** 2026-09-01
**Status:** Accepted 2026-09-02. Steps 1-6 and 8 of section 8 are **built** — the shared close
guard, the shell, its catalog, both fitness rules, two migrated families (the custodian's three
panels and ten across billing and costs), and the pane system of section 11, with the new-matter
window as its proof. Step 7 is open. The four questions in section 10 are answered.
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
- **`arrangement-dialog.svelte`** — it READS a record: the fee arrangement in force, its terms, and
  its version history, with one act (Amend) that opens a different panel. That is `RecordWindow`'s
  shape. Found during the billing migration, and it is the clearest answer to a question worth
  recording: **should a read-only panel be a fourth `kind` of `ActionDialog`?** No. A read-only kind
  would be a second answer to "read a thing", competing with the shell that already answers it, and
  it would make `commitLabel` and `onCommit` optional — weakening the type for every panel that does
  commit, and with it the rule that the commit owns the close.
- **`apply-trust-funds-dialog.svelte`** — not read-only either, on inspection: an act whose commit is
  not served yet. Its control is wrapped in `SoonAffordance`, the app's own primitive for a
  designed-but-unbuilt capability (disabled control, Soon badge, the dependency as the accessible
  description). That primitive lives in the app, so the design-system shell cannot carry it; the
  panel becomes a plain `ActionDialog` the day a route hands out a trust account.
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
2. **One new rule, `hand-composed-modal`, with three signals.** A composed
   `Dialog`/`AlertDialog`/`Sheet` panel outside a declared shell's home; a scrim written as
   utilities (`fixed inset-0` at the modal layer — the shape this repository actually writes, and
   the one the existing `<style>`-block rule cannot see); and a reach for the platform's own modal
   (`showModal`, `HTMLDialogElement`). It sits beside `findHandBuiltDialogs`, which already makes
   this argument about raw `<dialog>` and hand-built scrims and simply never reached one composed
   from the design system's own parts.

   **Which homes may compose a panel is declared, not hardcoded.** `registry.json` grows a
   `modalShells` block naming each home and why it is one, so adding a shell is a reviewed edit to
   the file that already answers "what is in the system". Being a registered component is
   deliberately not enough on its own — `RecordAttachments` is registered and still holds a
   confirmation that should be an `ActionDialog`, so it carries an allowance rather than an
   exemption. `PrintSheet` is a declared shell: it layers above a record window and undoes the
   panel's centring for the printed page, which is a third surface on purpose.

3. **All thirty-four go on the allowance list on day one, each with its reason.** The list is
   printed on every run, and `registry.json`'s discipline is that an allowance whose violation is gone
   is itself a failure — so a migrated panel must delete its line in the same commit, and the debt
   can only shrink. New work is bitten immediately; nothing in flight is blocked.
4. **A catalog, not a mockup.** The shell's six stories in Storybook — the three kinds, a commit
   refused with its reason, a commit the server turns down, and the guard — each of which runs as a
   behaviour test and an axe check. The `/developer-console/action-dialog` gallery this section
   originally called for belongs with the first app adopter rather than here: the dev-console
   galleries exist for app SCREENS whose reviewable states real data cannot reach, and a design-
   system component's catalog is Storybook.

5. **The footer set, asserted at the source.** `footer-set` reads the shell's own action bar and
   requires exactly the dismissal then the commit, in that order — the header set's sibling, and for
   the same reason. A reader who has learned where the commit sits has learned it in every panel in
   the product; a third control added to the shell would un-learn that everywhere in one edit.

6. **A marker the rendered DOM carries.** Both shells stamp `data-modal-shell` on their panel. A
   source scan cannot see a panel whose parts were aliased on import or chosen at runtime; a check
   over the rendered page can require the marker of anything holding the `dialog` or `alertdialog`
   role. That is the half of the enforcement that reads behaviour rather than text, and it is why
   the rule's own documentation names what it cannot catch instead of implying it catches
   everything.

## 8. Order of work

Each step lands on its own and leaves the app working. Nothing here waits on another branch —
section 4 is why.

|   # | Step                                                                                                      | Notes                                                                                                                |
| --: | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
|   1 | Register `ActionDialog` in `lint-one-ui`                                                                  | **Built.** The home landed with it, so it is registered outright rather than pending                                 |
|   2 | Lift the close guard out of `record-window.svelte` into the shared internal, `RecordWindow` still passing | **Built.** Behaviour-preserving; the record window's own tests are unedited                                          |
|   3 | Build the shell on that guard: catalog, tests. No adopters                                                | **Built.** No recipe of its own — it composes what Dialog already decides                                            |
|   4 | Adopt in `claude/custodian-refinements-19iycw` (3 panels) and `claude/matter-status-modal-wjzv1v` (1)     | New files — a rewrite, not a migration. Proves the contract before it binds                                          |
|   5 | Add the `hand-composed-modal` rule with all thirty-seven allowed                                          | **Built**, with `footer-set` beside it. Thirty-seven, not thirty-four: the rule reaches shapes the hand count missed |
|   6 | **Built.** Ten billing and costs panels migrated, their allowances deleted                                | Two of the twelve turned out to belong to the other shell or to a deferred capability — see 5.5                      |
|   7 | Migrate the remaining fifteen, deleting their allowances                                                  | The four `AlertDialog` confirmations are the cheapest and should go first                                            |
|   8 | **Built.** `new-matter-dialog.svelte` opens in `ActionDialog` with a `context` pane                       | Not `RecordWindow` after all — section 11 says why, and it is the frame's proof                                      |

The order had one real dependency and it was step 2 before step 3: building the shell first would
have meant writing the guard twice and reconciling two copies of a question the product asks in one
voice. Everything after step 5 is independently landable, one family at a time.

**One number moved.** The hand count found thirty-four panels; the rule finds thirty-seven, because
it reaches the `Sheet` panel and two design-system files a `Dialog.Content` grep over `apps/web`
never looked at. Twenty-six are in scope for migration and eight are named exclusions; the
thirty-seventh is `RecordAttachments`' detach confirmation, which is in scope and was missed by the
original survey for the mundane reason that it lives in the design system rather than the app.

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

## 10. The owner's answers

Settled 2026-09-02.

1. **The dismissal verb is "Cancel", for every kind of ask.** It is a single constant rather than a
   per-kind field, so no kind can drift back to a word of its own. It settled a thirteen-to-five
   split between "Cancel" and "Close".

2. **A form keeps its corner dismiss.** Unchanged from what shipped. A question still has none — it
   is answered, not dismissed.

3. **`new-matter-dialog.svelte` — answered by section 11, and differently from how it was asked.**
   The proposal was `RecordWindow` with `editing` raised. Reading the file settled it the other way:
   it is not a record being read, it is an ACT (open a matter) with context beside its fields (the
   client, and the clearance the work has to pass) — and its own head comment argues for exactly
   that shape, "a left side and a right side", before rebuilding the record window's frame by hand
   to get it. So the frame was extracted, `ActionDialog` gained a `context` pane, and the window
   moved onto it: 647 lines to 622, the hand-built bands and grid gone, the guard gained.

4. **A full-screen surface is a design choice every time, not a shell.** The time sheet, the cost
   review window and the website shell stay as they are. This is the answer this design wanted: a
   third shell for "presented over the app" would have had to absorb three surfaces that have
   nothing in common but their size.

**One correction to how this document argued.** Sections above framed these as cheap now and
expensive later. That was true of the world this shell replaced and is not true of the one it
creates: the point of a table in `action-dialog-model.ts` is that a ruling is one edit. Answer 1
changed a single constant. The genuine cost of deferring is only that migrated panels carry the old
word until the constant changes, which is a re-render rather than a rewrite.

## 11. The pane system: one frame under both shells

Raised by the owner on 2026-09-02 — "should we be implementing a pane system though? otherwise, we
have to build it each time?" — and answered by the largest panel in the app before any design was
written. `new-matter-dialog.svelte` opened with a header band, a `<Separator>`, a body that scrolled
alone, and a two-pane grid at two-thirds and one-third: the record window's frame, rebuilt from
utilities in 647 lines, with comments quoting the record window's own doctrine. **A pane system that
lives in one shell is a pane system every other panel rebuilds**, and that is the answer.

### 11.1 What the frame is

`styles/recipes/modal-frame.css` — an internal recipe, not an exported component — holding what the
record window used to hold alone: the panel (`p-0 gap-0`, fit-content, capped), the header band and
its identity block, the quiet header control, the body, the **primary pane** that stops at
`size.record-pane` beside a **context pane** that takes the rest, a **notice band** between the body
and the bar, and the **action bar** of fixed geometry. Every rule the record window's CSS used to
state — fit first then cap, the primary stops and the context continues, width rides a utility
because a recipe cannot win it — moved with its reasoning intact.

Two rules are new because a second shell needed them. A primary pane with **no context beside it
fills the frame** (`:only-child`), so a wide single-column form uses its width instead of leaving a
dead strip where a context pane would have been. And the **notice band sits outside the scroll,
directly above the action bar** — `new-matter`'s own argument: a refusal comes back from pressing the
commit, and a band at the top of a long form has scrolled out of sight by then.

### 11.2 What each shell keeps

`RecordWindow` keeps every `mc-record-window-*` class name on every element — they are the hooks the
catalog's geometry assertions and the header-set rule read — and adds the frame's class beside each.
Its own recipe shrinks to the tab strip in its context pane, which is the one thing only a record
window has. `header-set` loosens from an exact attribute match to a class token so the group can
carry both names.

`ActionDialog` moves onto the frame outright: the corner dismiss becomes an inline header control
where the record window's close sits, the fields go in the primary pane, the notice in the band,
the two footer controls in the action bar. It gains a **`context` snippet** — the record window's
right pane lent to a form — and a context pane **implies the record width** whatever `width` asked
for, because two panes have a geometry of their own and a caller should not discover that by eye.
Focus lands on the first field rather than the header's own dismiss.

### 11.3 The proof that nothing moved

The four record-window stories that show the frame — default, editing, fits-without-scrolling,
caps-and-scrolls-its-body — were screenshotted from the static catalog before the extraction and
after it, at 1440×900. **All four are byte-identical.** The record window's six stories, including
the two that assert its sizing as rendered geometry, pass unchanged. That is the standard a shared
chassis has to meet: the shell it was taken from cannot tell.

### 11.4 The reading kind — a position reversed on evidence

The owner asked whether read-only panels should be a variant of the modal. The first answer was
no. Working through the two panels that looked read-only, `arrangement-dialog` was a record with
history and an action — `RecordWindow`'s shape — and `apply-trust-funds` was an act whose commit
is not served yet; a read-only `kind` looked like a second answer to "read a thing", and making
`commitLabel` and `onCommit` optional would have weakened the type for every panel that commits.
The pane system was what those two were rebuilding, so the pane system was what filled the gap.

Then a third panel arrived that neither argument covered. The matter-status window (#473, merged
the same day) opens from the seal in the matter's header to say what the matter's status is and,
when the reader has the right to change it, offers the step — Close Matter, Reopen — **seated in
the body beside the fact it changes**, deliberately not in the action bar: somebody may have opened
the window to read the physical-file pane beside it, and the corner is where a hand goes by habit.
It is not a record (it has no tabs, no history, no editing mode — `RecordWindow` would be the wrong
shape). It is not an act asked of a reader either: its bar has nothing to commit, and a `form` kind
would have forced a commit button into it that its design had rejected. It composed `Dialog.Content`
by hand, the rule refused it, and nothing before merge had run the rule.

So the shell now has a fourth kind, and the type is not weakened to admit it — the props are a
**discriminated union on `kind`**, and each arm stays as strict as it was:

```ts
type Acting = { kind?: "form" | "confirm" | "destructive"; commitLabel: string; onCommit: () => Promise<ActionOutcome>; … };
type Reading = { kind: "reading"; commitLabel?: never; onCommit?: never; … };
```

A form still cannot omit its commit; a reading panel cannot be given one. `kind="reading"` renders
on `Dialog` with the corner dismiss, is dismissed by a press outside, runs no guard (there is
nothing to lose unless the caller says `unsavedChanges`), and its bar holds one control that says
**Close** rather than Cancel — nothing was begun, so nothing is cancelled. The kind table gained a
row with `commitVariant: null`, and the action bar renders the commit only when the variant is not
null; `footer-set` still asserts both markers in the shell's source, because the source still
carries both.

What this is not: a read-only `RecordWindow`. A record is read in the record window, and the
reading kind is not a way around that — it is the panel for a fact with a step beside it, whose
context pane earns the record width without the record's tabs. The distinction the shells draw
(read a record; be asked for an act) gains a third clause: read a fact and take a step from where
it sits. Three panels are known to have this shape; the status window is the first to land.

### 11.5 What the first fifteen callers asked for

With fifteen panels on the shell, what they still repeated was measured rather than guessed at, and
four of the findings became shell or design-system changes on 2026-09-02, owner-approved:

- **Enter commits, from the shell.** None of the fifteen had wired Enter, because each would have had
  to. The primary pane is now a real `<form>` and the commit is its submit button, associated by id
  since the bar sits outside the pane; the platform's implicit submission does the rest, and a
  disabled commit (a refusal, or an act not served yet) stops Enter for free. Ctrl+Enter or
  Cmd+Enter commits from a textarea, where Enter must go on meaning a new line. `novalidate`,
  because a refusal is the shell's and is stated beside the commit, never as a browser bubble.
- **`subtitle` takes a string.** Twelve of fourteen subtitle snippets were plain text. The prop is
  `string | Snippet`; the snippet arm stays for a subtitle that carries markup.
- **`commitSoon`, and the maturity family moves into the design system.** Two panels composed
  `SoonAffordance` around a commit of their own, and carried allowances for it because the affordance
  lived in the app and the shell cannot import the app. The whole maturity vocabulary — the model,
  the badge, the dot, the affordance — is now `@magna-carta/design-system/maturity`, with one home
  and its tests moved with it; the acting arm gains `commitSoon: { reason }`, and the shell wraps its
  own commit in the affordance. The bar still holds exactly one commit in the shell's source: the
  control is one snippet rendered one of two ways, which is what keeps the `footer-set` rule true.
- **`LabelledField` and `FieldRow`.** The label-over-control column was written by hand fifty-six
  times across the fifteen, and the two-or-three-across row sixteen times; about a third of the
  hints had no `aria-describedby`. `LabelledField` mints the id, joins the hint and the error into
  the control's description, marks an error invalid, and hands the control its attributes as `props`
  to spread — formsnap's own idiom. It is deliberately not the form family's `Field`, which is bound
  to superforms; the two stack the same parts at different gaps (space-8 here, as every panel had
  it; space-4 there), and that difference is stated on the recipe for the owner to settle rather
  than smoothed over. `FieldRow` is utilities only, because a breakpoint is the one thing a recipe
  cannot express.

Two findings were deliberately not built. A third bar control (bug-report and request-change carry
Close, Copy and Send) is refused on the same ground as before: the copy belongs in the body beside
the text it copies, as the reading kind seats its step. And an app-side failure helper — the twelve
lines every caller writes around `FailureNotice` — is the app's side of the notice seam and stays
out of the design system; it is queued for the migration pass that touches every caller anyway.

### 11.6 A commit that stays: the `done` outcome

The confirmation family — the file manager's three panels, the note and party removals, the
settings recap, the attachment detach — was the first to need something the seams above did not
give: the upload panel saves its destination and then **stays open while the batch lands**, its
report column ticking, until the host closes it. Two of the panels still to migrate have the same
shape (bug-report shows its filed reference; new-document shows what it made). So `ActionOutcome`
gains a third value. `"done"` leaves the panel standing as a panel with nothing left to ask: the
commit leaves the bar, the dismissal reads Close, the guard stands down, and `fields` and `context`
are handed `done` beside `busy` so one snippet renders the panel before and after. It is the reading
kind's bar arrived at by acting, which is why it costs the shell one flag and no new branch.

The same family put the upload panel's report in the **context pane**, where it had been a second
grid column inside a `max-w-record-pane` dialog: the decision on the left is the fields, the report
on the right is the context, and the frame's rule — the primary pane stops, the context takes the
room — is exactly what a live list beside a still choice wants. The bar's hint ("closing keeps what
has landed") moved into the body, because the bar is the shell's.

### 11.7 Where the migration ended

Twenty-seven panels moved onto the shells across six pull requests on 2026-09-02, in families:
custodian (3), billing and costs (10), the new-matter window, the status window (the reading kind),
the confirmations (7, with the `done` outcome), the forms (4, the first callers of `commitSoon` and
`LabelledField`), the send panels (3, with `restoreFocus`), and the last two — the new-document flow
and Apply Trust Funds, which the Soon affordance's move into the design system admitted.

Six `hand-composed-modal` allowances remain, and every one is a named exclusion rather than debt:
the command palette (a launcher, the documented Command-in-a-Dialog pattern), the settings ledger
(a Sheet holding context), the three full-screen surfaces (a separate design, deliberately not
folded into this one), and the fee-arrangement window (`RecordWindow`'s shape, migrated when that
stream is open). The register prints them on every run with the reason each stands on, so the list
stays read.

A correction, recorded because it is the kind of mistake the register exists to catch: the four
directory panes were excluded as "panes inside a surface, not modals," which described the files
and not the hits. Each pane composed a real form dialog — Assign A Category, Record A Way To Reach
Them, Record An Identifier, and the names pane's Change and Record — and those five migrated on
2026-09-03 once the reason was re-read against the line it excused. An allowance's reason should
name the panel it excuses, not the file that holds it.

What the migration left for the next pass: the fifteen panels that landed before `LabelledField`
existed still write the label-over-control column by hand, and every caller still writes the same
twelve lines around `FailureNotice`. Both are mechanical, both are the app's side of a seam the
shell already has, and neither should be done panel by panel.

### 11.8 Filling the screen is the frame's

The owner asked whether full-screen should be an expansion available to every modal, and whether
the full-screen parts should be combined. Both, and the tree said why. The record window had a
corner control that fills the viewport, remembered for the session; the action dialog had none;
and the three surfaces excluded as "full-screen" were three different things — the time sheet had
rebuilt the record window's expand by hand inside a raw dialog, the screenshot viewer was a reading
panel that opens filling the screen, and the cost review was a queue walked one cost at a time, not
full-screen at all. The ruling that full-screen is a design choice each time had been read as "each
surface builds its own"; it reads just as well as "each surface decides whether to open that way".

So the frame owns expand (`internal/frame-expansion.svelte.ts`): the state, the control's two
names, the expanded geometry, and one session memory per shell — records at full viewport is a
posture for a sitting, a form filled to the screen is a choice about that form, and the two are
kept apart. Each shell keeps its own control in its own header set, because the record window's
set is asserted at the source. `ActionDialog` offers it on the Dialog kinds, `form` and `reading`,
and never on a question. Both shells take a bindable `expanded`, which is how a panel opens
expanded by design. The record window's frame-bearing stories are byte-identical before and after,
per the standard for touching the frame; the three surfaces migrate in the pass that follows.

The pass that followed brought the three onto the shells the same day. The time sheet is a reading
panel opened expanded, its toolbar the first row of its pane and its identity the frame's header;
its hand-built expand is deleted, and the windowed state it shrinks back to is the record width
rather than its old 97vw. The screenshot viewer is a reading panel opened expanded. The cost review
is a reading panel whose three answers sit under the facts they decide — Skip, Kick Back, Approve —
and walks on to the next cost rather than closing, which is what the reading kind's "take a step
from where it sits" was for. Three allowances remain: the command palette, the settings ledger's
Sheet, and the fee-arrangement window.
