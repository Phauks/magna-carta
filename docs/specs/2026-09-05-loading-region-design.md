# One loading state — design

**Date:** 2026-09-05
**Status:** Accepted 2026-09-05 by the owner, from
[`../research/2026-09-05-skeleton-loading-framework.md`](../research/2026-09-05-skeleton-loading-framework.md)
("I like C the best. Let's continue on this path, and make it so all skeleton loading runs through
this style, and leave tests and linting so it cannot stray"). **Built** in the same stream: the
component, its recipe and story, the `lint:one-ui` rule and its tests, the developer-console
gallery, and the migration of every loading state in `apps/web`. **Second round, 2026-09-06**
("begin work on these improvements"): the region holds the whole state set, refreshing, the
stall, the finished announcement and the settle measurement (section 9); the sample vocabulary;
two more rules; the contrast measurement.
**Scope:** how a region of a screen in `apps/web` says its data has not arrived — the one
component that renders that state, the recipe that draws it, the fixture that gives it a shape,
and the gate that keeps a second way from growing back.
**Excludes:** the ceremonial whole-app loading screen the design language reserves for sign-in
and first launch (a signature moment with its own home); the busy state of a live act (a capture
narrating its stages, a search field with a query in flight, a button refreshing), which is not a
placeholder and is recorded as such; the "Load more" and submit relabels, which are controls
naming what they are doing.

**Binding inputs:** the archetype state set ("Loading — skeleton rows/cards (no spinner-only
screens)", [`2026-06-12-page-archetypes.md`](2026-06-12-page-archetypes.md)); golden rules 1, 2,
10 and 12; the owner's rulings in
[`../conventions/design-corrections.md`](../conventions/design-corrections.md): a result region
is furniture, not a reward; a placeholder row is not a row; a failed read settles the list and
offers Retry instead of leaving the skeleton standing; and the 2026-08-29 direction that a
reviewable shape lives in the code that ships, never in a disposable copy of it.

---

## 1. The decision in one paragraph

**The component is its own skeleton.** A region whose data has not arrived renders its real
markup over representative content inside `LoadingRegion`, and one CSS recipe turns the leaves of
that markup into bones while the furniture stays real. Nothing is measured, nothing is captured,
and nothing is drawn by hand, so the placeholder cannot drift from the screen it stands in for. The
region takes the two facts only its caller knows, whether it is loading and what it is reading, and
owns everything else by having no prop for it. `Skeleton` stays as an internal box for the
design-system components that render placeholder rows of their own shape, and leaves the public
surface. A `lint:one-ui` rule fails any hand-placed loading state on either side of the line.

## 2. The component

`@magna-carta/design-system/loading-region`, Tier 1, Feedback category, registered in
`tooling/lint-one-ui/registry.json`.

```svelte
<LoadingRegion loading={rows === null} label="Reading this record's names" class="flex flex-col gap-8">
  {#snippet fixture()}
    <!-- the same components the real content uses, over two or three rows of sample words -->
  {/snippet}
  {@const shown = rows ?? []}
  {#if shown.length === 0}<EmptyState title="…">…</EmptyState>{:else}<!-- the content -->{/if}
</LoadingRegion>
```

| Prop         | Type         | Meaning                                                                                                                                                           |
| ------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loading`    | `boolean`    | Required. Every signal the app produces (`x === null`, a `PagedList`'s `items === null`, a controller's `loading`, a future query's `isPending`) reduces to it.   |
| `label`      | `string`     | Required. The sentence assistive technology hears, in the house voice: "Reading this record's contact details". A region that says nothing is the defect.         |
| `fixture`    | `Snippet`    | Optional. The shape while loading, rendered instead of the children. Omitted where the children render before their data exists and their furniture is the shape. |
| `children`   | `Snippet`    | The content, rendered once settled (and while loading when there is no fixture).                                                                                  |
| `class`      | `string`     | The region is the layout element; the old wrapper's utilities move onto it.                                                                                       |
| `failed`     | `boolean`    | Renders the `failure` snippet first, whatever else is true. The surface's failure notice with Retry lives in the snippet.                                         |
| `empty`      | `boolean`    | Renders the `emptyState` snippet in place of the children once settled.                                                                                           |
| `refreshing` | `boolean`    | A re-read of something on screen: the content stays, the region is busy and the sentence is spoken. Ignored while `loading`.                                      |
| `onRetry`    | `() => void` | How to ask again. Offered beside the stalled sentence; the failure snippet carries its own.                                                                       |

While loading the region carries `data-mc-loading`, `inert` and `aria-busy="true"`, and a
visually-hidden status line before it carries the sentence; when the content lands the same line
says the read finished ("Finished reading the names on this record."), which is what a polite
live region announces. `inert` is what makes the fixture safe: nothing in it can be
focused, pressed, selected or read as if it were real, which is also why a fixture never needs an
"example" marker. `aria-busy` alone is honoured by few screen readers, so the sentence is the
announcement and the bones are hidden rather than relied on.

## 3. The recipe

`loading-region.css`, imported **last** in `styles/components.css` so its rules win at equal
specificity over every recipe a region can hold.

- Text is hidden with `-webkit-text-fill-color: transparent` rather than `color`, because a
  utility on a leaf (`text-text-muted`) sits in Tailwind's utilities layer and beats any `color`
  set in the components layer at any specificity; nothing in the product sets text-fill-color.
- A text leaf is any element with no element children and some text (a heading, a span, a cell,
  a card's title, which is a `div`). It becomes a bar the width of its words, one bar per wrapped
  line; a block of text keeps to the width of its words rather than stretching; a cell's bar is
  its content box, so neighbouring cells never merge.
- `svg` and `.mc-avatar` become their own box; `img`, `video` and `canvas` are hidden.
- A control (`button`, `input`, `select`, `textarea`, the button, checkbox and switch roles,
  `.mc-badge`, `.mc-button`) becomes one bone.
- Furniture stays real: `th`, `label`, `legend`, `caption`, `dt`, `.mc-label`, `.mc-field-label`
  and anything carrying `data-loading-keep`. `data-loading-block` makes a container one bone.
- The pulse is the Skeleton's own colour animation between `--mc-action-disabled` and
  `--mc-surface-sunken`; `prefers-reduced-motion` and the developer console's
  `data-mc-static-skeletons` freeze silence it.

## 4. Fixtures, in order of preference

1. **None.** The component's furniture is the skeleton: a labelled-field group with empty values,
   a header, a settings form.
2. **A fixture snippet beside the surface**, in the same file, in the same components the real
   content uses, over two or three rows of plausible sample words of the right length. Never a
   real client's data.
3. **A count.** The design-system components that render repeated rows of their own shape
   (`DataTable.Grid`, `EventRail`, `RecordParties`, `RecordAttachments`, `CalendarGrid`,
   `FolderTree`) keep a `loading` prop and render that many placeholder rows from inside; the
   Grid's count prop is `placeholderCount`, the one name.

## 5. Rulings recorded

- **A loading region always has a failure exit.** The failure is the region's own first state:
  `failed` renders the `failure` snippet before anything else, so a failed read settles to
  `FailureNotice` with Retry and never leaves the shape standing (the 2026-09-01 Notes ruling,
  made structural). A read that stays in flight past fifteen seconds says so on the screen, above
  the shape, and offers Retry when the caller can ask again.
- **First read shows the shape immediately; a re-read keeps the stale content.** The region does
  what its `loading` says; the keep-stale rule is the caller's, already written into `PagedList`.
- **No spinner-only state, no loading sentence in place of a shape.** The three sentences and two
  static glyphs the inventory found are gone; a control naming its act ("Sending…", "Loading" on a
  Load more) is not a placeholder and is untouched.
- **A re-read keeps the content and says so.** `refreshing` is the region's posture for something
  already on screen being read again: nothing greys, the region is busy, the sentence is spoken.
  The Refresh control and the directory's duplicate check use it; a busy live act that is not a
  read at all (a search field with a query in flight, a capture narrating its stages) keeps its
  own `aria-busy` under a recorded allowance with its reason, printed on every run.

## 6. The gate

`lint:one-ui` rule `hand-placed-loading`, proved in `tooling/lint-one-ui/index.test.mjs`. In
`apps/web` none of these may appear: the Skeleton import or tag, the `mc-skeleton` class,
`aria-busy`, `animate-pulse`, a Lucide loader glyph. Inside the design system the same signals are
allowed only in the `loadingHomes` the registry declares (the region, the Skeleton box, and the six
components that render placeholder rows of their own shape). The `./skeleton` export is gone, so an
app import fails at resolution before it fails at lint. Allowances live in the registry with a
reason and fail when they outlive their violation.

Two more rules, proved the same way. `silent-loading`: a `=== null` branch that renders nothing,
or a bare "Reading…" sentence, is a screen with no Loading state; a null that means "not set" and
renders words of its own is left alone, because most null sentinels in the app mean that.
`fixture-shape`: every component a fixture renders (with `{@render}` expanded to the snippet it
names) must appear in the region's children, so a fixture that stopped matching its surface fails
instead of drifting; sharing one snippet between the fixture and the content is what makes the
rule trivially true.

## 7. The review surface

`/developer-console/loading-states` renders a record detail, a table region and a card grid as
regions over the sample vocabulary, each beside its settled state, with a Loading switch and the
static placeholders switch, and below them the state set — failed, empty, refreshing, and a stall
with the threshold shortened through the component's one test seam — so the owner reviews the
whole set on the deployed site.

## 8. Open

- The bone contrast against WCAG 1.4.11. Measured from the generated tokens
  (`test/fitness/loading-contrast.test.ts`), the bone sits between 1.16:1 and 1.59:1 on the three
  surfaces across all six themes in both modes, against a 3:1 target for a meaningful graphic. The
  test pins a floor under the faintest pairing so a token change cannot make a bone vanish, and
  prints the ratio beside the target on every run. Whether a bone is a meaningful graphic (the
  loading state is carried by the sentence) or the pulse should meet 3:1 is the owner's call.
- Whether the query layer of ADR-0054 lands, which would make `loading` and `refreshing` fall
  out of one place; and Svelte's async mode, once it leaves the experimental flag, whose pending
  snippet could feed the region directly.

## 9. The second round, recorded

- **Four states in one contract.** `failed`/`failure`, `empty`/`emptyState` join `loading`/
  `fixture` and the children. The repeated `{#if failure} … {:else if x === null} … {:else if
  x.length === 0} … {:else}` chain is gone from every surface; the region decides the order.
- **Refreshing.** `refreshing` keeps the content and marks the region busy; the keep-stale rule
  `PagedList` carried is now the region's.
- **The stall.** `STALLED_AFTER_MILLISECONDS` (15 s) in `loading-region.ts`; past it the region
  shows "Still reading …. This is taking longer than it should." with Retry when `onRetry` is
  given. `stalledAfter` is the one test seam, used by the hidden Behaviour story and the gallery.
- **The finished announcement.** One `role="status"` line, always in the document, whose words
  move from the label to `finishedSentence(label)` on settle.
- **The measurement.** Every settle writes a User Timing measure (`mc-loading <label>`) and
  dispatches a bubbling `mc-loading-settled` event with the label, the milliseconds and whether it
  failed; the app shell is the one listener and records a `loading` breadcrumb, so a report says
  which reads a member waited on and for how long.
- **The sample vocabulary.** `@magna-carta/design-system/loading-fixtures`: invented people,
  organizations, matters, dates, amounts and one sentence, by index, so every fixture's words are
  plausible, stable and provably not a client's.
- **The third round (2026-09-06).** `loading-label`, the fourth rule: a literal label starts with a
  capitalised gerund, never "Loading", and ends without punctuation, because the region derives
  its finished and stalled sentences from it. The callers the second round left short now hand
  their regions what they can use: the conflicts matter page passes Retry to the posture panel,
  the file manager carries a failed versions read into the inspector instead of collapsing it to
  "no versions yet" and guards the integrity check against a second concurrent run, the matter
  search's callers supply its re-ask, and the version chip's two regions each announce only their
  own re-read. Every fixture date is on the vocabulary in the shape its column needs. The
  developer console's performance module lists the reads the tab waited on, read from the User
  Timing measures the regions write.
- **Not done, and why: the cheaper pulse.** Animating one registered custom property on the region
  needs `@property` with a `syntax` string, which the recipe purity gate refuses, and animating
  `color` for the leaves to read as `currentColor` breaks the moment a utility sets a leaf's colour.
  The per-leaf colour animation stays; it is paint, not layout, and no region has shown a cost.
