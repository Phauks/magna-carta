# One loading framework — research

**Date:** 2026-09-05
**Status:** Research complete. **Not a spec and not a decision.** Nothing here is built. It answers
the evaluation the owner flagged on 2026-06-13 in
[`packages/design-system/CLAUDE.md`](../../packages/design-system/CLAUDE.md) ("if skeleton drift
becomes real pain across many components, spike it properly: adopt, or borrow the measuring-wrapper
idea in-house with token-driven shimmer"), and the owner's 2026-09-05 ask for one generalized way to
show that something is loading or about to load, ideally one that derives the placeholder from the
finished screen instead of being drawn by hand.
**Scope:** in-work loading in `apps/web` and `packages/design-system` — a region of a screen whose
data has not arrived. **Excludes:** the ceremonial whole-app loading screen the design language
reserves for sign-in and first launch (gold-on-vellum, rotating foundational-law quotes, the
written-live wordmark); that is a signature moment with its own home, not a placeholder.
**Binding inputs:** the state set every archetype ships
([`../specs/2026-06-12-page-archetypes.md`](../specs/2026-06-12-page-archetypes.md): "Loading —
skeleton rows/cards (no spinner-only screens)"); golden rules 1, 2, 10 and 12 in
[`../../CLAUDE.md`](../../CLAUDE.md); the owner's rulings in
[`../conventions/design-corrections.md`](../conventions/design-corrections.md) (a result region is
furniture, not a reward; a placeholder row is not a row; a failed read settles the list and offers
Retry instead of leaving the skeleton standing); ADR-0076 (the design system) and ADR-0054 (client
data state).

---

## 1. The finding in one paragraph

The app has exactly one loading primitive, `Skeleton`, and it is a sized-by-the-caller grey box with
no opinion about what it stands in for. Eight design-system components wrap it behind a `loading`
prop under three different names for the same count. Everything else is hand-placed: **89
`<Skeleton>` tags across 37 files in `apps/web`**, sized by roughly seventeen freehand utility
combinations, about half of them outside the `aria-busy` region the primitive's own comment says is
required. Three surfaces show a sentence instead, two show a static icon, and the form and pagination
busy states each have their own wording convention. Every one of these is drawn from the author's
memory of the finished screen, which is why they drift from it. The libraries that promise to
derive the skeleton automatically all hit the same wall: **a data-driven component has no shape until
it has data**, so every one of them, runtime or build-time, needs representative content to measure.
Once that is accepted the measurement step is unnecessary. The recommendation is to make **the
component its own skeleton**: render the real markup over a fixture inside one design-system
region that turns every leaf into a bone with CSS, announces the state once, disables interaction,
and swaps to the real content when the read settles. No measurement, no second implementation of any
screen, no new dependency, and a lint rule that retires the hand-placed form.

## 2. What the app does today

### 2.1 The primitive

`packages/design-system/src/lib/components/skeleton/skeleton.svelte` is a Tier 1 `<div
aria-hidden="true" class="mc-skeleton">` whose only props are `ref`, `class` and a rest spread. The
recipe in `skeleton.css` pulses `background-color` between `--mc-action-disabled` and
`--mc-surface-sunken` on the `slow` duration rung (a colour animation, because opacity literals are
banned), is silenced under `prefers-reduced-motion`, and honours a root `data-mc-static-skeletons`
attribute the developer console sets so a placeholder that will never resolve does not shimmer. Its
comment states the contract: size comes from the caller, the loading state is announced by the
region, never by the boxes.

That contract is sound. What is missing is the region.

### 2.2 Inventory of the shapes in use

| Shape                                                                                     | Where                                                                                                                                                                                                                       | Count                                                   |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Hand-stacked bars** in an `aria-busy` div with a label sentence                         | the seven `apps/web/src/lib/directory/*-pane.svelte`, `custodian/packet-window.svelte`, `calendar/entry-window.svelte`, `versions/version-chip.svelte`, the directory, downloads, home, resources, event-types routes       | 19 regions                                              |
| **Hand-stacked bars with no region at all** (no `aria-busy`, no label)                    | matter notes, overview, conflicts check, forms assemble, matter-plans, intake-procedures, versions settings, `matter-search-results`, `plan-proposal`, `task-list`, `posture-panel`, safe-browse, file-inspector, documents | 16 sites                                                |
| **Design-system component with its own `loading` prop**                                   | `DataTable.Grid` (`skeletonRowCount`), `EventRail` and `CalendarGrid.Agenda` (`placeholderCount`), `RecordParties`, `RecordAttachments`, `CalendarGrid.Week`, `CalendarGrid.Month`, `FolderTree` (fixed constants)          | 8 components; `DataTable.Grid loading` used at 15 sites |
| **A loading sentence** (`Reading the checks this firm has run.`)                          | `conflicts/hit-window.svelte`, settings calendar, conflicts index                                                                                                                                                           | 3                                                       |
| **Load-more button relabelled** (`Loading` with no ellipsis)                              | activity register, custodian history and register, matter costs, time, calendar, matters, directory                                                                                                                         | 8                                                       |
| **Form submit relabelled** (`Sending…` with ellipsis) or a `role="status"` `Saving…` line | the auth screens, safe-browse capture, document panel, directory edges and pronouns panes                                                                                                                                   | 14                                                      |
| **A static `loader-circle` icon** (no spin, no announcement)                              | `time/time-sheet.svelte`, `file-manager/upload-dialog.svelte`                                                                                                                                                               | 2                                                       |

Bar sizes seen in the wild: `h-12`, `h-16`, `h-20`, `h-24`, `h-32`, `h-48`, `h-64` crossed with
`w-full`, `w-5/6`, `w-3/4`, `w-2/3`, `w-1/2`, `w-64`, `w-96`, `w-128`, `w-160`, `max-w-md`, in stacks
of one to four with no rule for the count. Two directory panes that render the same table shape use
one bar and two bars respectively. That is the drift the owner flagged, measured.

### 2.3 How the loading signal is produced

Not SvelteKit `load` functions (the thirteen `+page.ts` files are guards and redirects), not
`{#await}` (two uses, both code-splitting), and not the TanStack Query layer ADR-0054 decided on
(`@magna-carta/api-client` generates the query bindings; `apps/web` has zero consumers). The
mechanism is a **`null` sentinel on `$state`** set inside a `$effect` fetch: `{#if x === null}`
appears 108 times. The one shared abstraction is `apps/web/src/lib/matters/paged-list.svelte.ts`,
whose `items` is null until the first read lands, whose `loadingMore` is true only while a further
page is in flight, and whose header records the one timing rule the app has: a reset is keyed on the
subject so a re-read never flashes a skeleton over a table the reader is still looking at.

Two consequences for the framework. It must take a plain boolean, because that is what every
surface can produce today and what `isPending` will produce if the query layer arrives. And it must
make the failure exit structural, because the 2026-09-01 Notes ruling was about a read that could
be aborted before it was asked for, leaving the skeleton standing forever.

### 2.4 Rules that already bind

- Loading is skeleton rows or cards, never a spinner-only screen (archetype state set).
- The frame renders at rest and data fills a shape the reader already has (furniture rule). A
  placeholder row is not a row and takes none of a row's hover or selection treatment.
- Animate compositor properties only; the pulse is a colour animation between tokens; the motion
  axis (`data-motion` full / reduced / off) re-points the duration ladder structurally, and any
  JS-driven motion consults `internal/motion-preference.ts`.
- Identity concentrates at the ceremonial edges; a work surface's loading state stays calm.
- Golden rule 10: no measurement or heavy work on the UI main thread in the hot path.
- Golden rule 12: names are spelled out. `Skeleton` is a universal term and stays; the region that
  wraps it needs a full name.

## 3. What "automatic" can mean

Every library surveyed belongs to one of three families. The families differ in **where the shape is
measured**, and they share one constraint that no marketing copy states plainly: the shape has to
come from somewhere, and a list of matters has no shape without matters.

### 3.1 Family A — measure the real DOM at runtime

`phantom-ui` (Lit web component, 795 stars, framework-agnostic), `auto-skeleton` and
`react-skeletonify` and `skelon` (React). When `loading` is true they render the real children
invisibly (`color: transparent`, media hidden), walk the leaves, call `getBoundingClientRect` on each,
classify by heuristic (round means avatar, interactive means button, font metrics mean text), and
draw absolutely-positioned bones over the result. Every one of them documents the same two limits:
the children must be renderable without data, so the caller supplies placeholder content anyway;
and measurement is a forced synchronous layout over every leaf on every loading transition, which
`auto-skeleton` itself rules out for virtualized lists and frequent transitions. `phantom-ui` is the
one the design-system note already evaluated: it also brings a second component runtime (Lit) and
its own colour properties outside the token system.

### 3.2 Family B — capture the shape at build time

`boneyard-js` (7.3k stars, MIT, Svelte 5 adapter on snippets, a Vite plugin) and the older
`page-skeleton-webpack-plugin` lineage. A headless browser (Playwright, a **runtime** dependency of
`boneyard-js` 1.10) visits the running dev server, finds every `<Skeleton name="…">`, waits for the
queries or renders a `fixture` snippet, snapshots the leaf geometry at three breakpoints into a
committed `.bones.json`, and a 7.5 kB runtime draws those rectangles by name while loading. This is
the closest thing to "learn what the final product will be". Its costs against this repository:

- The bones are absolutely-positioned rectangles inside a box of captured height, so they do not
  reflow with a resize between the three widths, a longer caption, a wrapped title or a different
  row count. Drift moves from "the author forgot" to "the capture is stale", and nothing fails when
  it is.
- Capture needs a dev server and a browser. The gate of record runs in GitHub Actions, where that is
  feasible; the production build runs in Cloudflare Workers Builds, where it is not, so bones are a
  committed artifact regenerated by a separate step somebody must remember.
- It styles its own bones (`color`, `darkColor`, `animate`) rather than the `mc-skeleton` recipe, so
  golden rule 2 is met only by ignoring half its API.
- A `name` registry per placement is a second naming surface to keep unique across 37 files.
- It still needs a fixture for anything that cannot render empty, which is most of what loads here.

### 3.3 Family C — the component is its own skeleton

The technique the runtime libraries use _before_ they measure, kept and finished: render the real
markup over representative content inside a region that carries `data-loading`, and let a stylesheet
turn the leaves into bones. Text becomes a bar the width of the fixture text (`color: transparent`
plus a token background and radius; `box-decoration-break: clone` gives each wrapped line its own
bone). Icons, avatars and images become their own box. Controls become one bone each. Containers,
borders, headings and table frames stay real, which is exactly the furniture rule. The region is
`inert`, so nothing in it can be focused or clicked, and carries the one `aria-busy` and the one
visually-hidden sentence.

No measurement, so nothing on the main thread beyond one style recalculation. Nothing to capture or
commit. The skeleton cannot drift from the component because it _is_ the component. Dark mode,
density, the motion axis and the static-skeletons switch all keep working because the recipe is
token-fed. The cost is the one every family pays: a fixture. Here that cost is lowest, because
most of a Magna Carta screen is furniture that renders at rest with no data at all, and
`@magna-carta/fixtures` already exists to make representative rows.

### 3.4 Verdicts

| Candidate                                                     | Family | Verdict                    | Why                                                                                                                                                                                              |
| ------------------------------------------------------------- | ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| In-house structural region on the `mc-skeleton` recipe        | C      | **Recommend**              | Zero dependencies, zero measurement, token-native, cannot drift, reuses the primitive and the fixtures package, fits the furniture rule and golden rules 1, 2, 10                                |
| `boneyard-js` 1.10                                            | B      | Watch; trial on one screen | Best-in-class of its family and Svelte 5 native, but committed geometry, a browser in the build, a runtime Playwright dependency and a foreign styling surface; revisit if fixtures prove costly |
| `phantom-ui`                                                  | A      | Skip                       | Already evaluated 2026-06-13: Lit runtime, non-token colours, per-transition measurement; nothing has changed the fit                                                                            |
| `auto-skeleton`, `react-skeletonify`, `skelon`                | A      | Skip                       | React-only, 2 to 26 stars, single author, the same measurement cost; useful only as a reading list for leaf-classification heuristics                                                            |
| `svelte-skeleton-loader`, `svelte-skeleton`                   | —      | Skip                       | Svelte 3 era (last publish 2021), Emotion CSS dependency, no runes                                                                                                                               |
| Flowbite Svelte Skeleton                                      | —      | Skip                       | A second component library for five fixed shapes; ADR-0076 rejects the library route                                                                                                             |
| Svelte async (`await` in markup, `<svelte:boundary pending>`) | —      | Not yet                    | Still behind `experimental.async` in Svelte 5.56, the `pending` snippet renders on first creation only, and the app does not await in markup; a later signal source, not a foundation            |

## 4. The proposed framework

Everything below is a proposal for the spec that would follow. Names are placeholders for the owner
to rule on.

### 4.1 One region component

A design-system component, working name **`LoadingRegion`**, in the Feedback category:

```svelte
<LoadingRegion loading={names === null} label="Reading the names on this record">
  {#snippet fixture()}
    <NameRows names={fixtureNames} />
  {/snippet}
  <NameRows {names} />
</LoadingRegion>
```

- `loading: boolean` — the only signal it takes. A `null` sentinel, a `PagedList`, a controller's
  `loading` getter or a future query's `isPending` all reduce to it.
- `label: string` — the visually-hidden sentence, in the house voice already used ("Reading this
  record's contact details"). Required, so the sixteen silent sites cannot recur.
- `fixture` snippet — what to render as the shape while loading. **Optional:** when absent the
  region renders `children` and relies on the component rendering its resting furniture, which is
  enough for headers, labelled fields and any surface whose empty shape already exists.
- While loading it renders one `<div aria-busy="true" inert data-mc-loading>` holding the sr-only
  sentence and the fixture under the `mc-loading` recipe; when settled it renders `children`. The
  swap is instant by default; a crossfade is a token-duration opt-in and runs on `opacity` only.
- The region carries no `class` prop and no colour props, on the `ActionDialog` model: what it owns,
  it owns by having no prop for it.

### 4.2 One recipe

`mc-loading` lives beside `mc-skeleton` and reuses its pulse. It targets leaves by element, not by
class, so a screen opts in by being wrapped rather than by being rewritten:

- Text-bearing leaves: `color: transparent`, the bone background, `--mc-radius-sm`,
  `box-decoration-break: clone`, `user-select: none`.
- `svg`, `img`, `video`, the avatar: the bone background on the element's own box; strokes go
  transparent through `currentColor`.
- `button`, `input`, `select`, `textarea`, the badge, the switch: one bone each, borders and shadows
  cleared.
- Containers keep everything. The table frame, the card edge, the section rule and the divider are
  furniture and stay.
- Two escape hatches as data attributes, on the `phantom-ui` and `auto-skeleton` precedent:
  `data-loading-keep` (this element stays real, for a static heading inside a loading region) and
  `data-loading-block` (treat this container as one bone, for a chart or a map).
- The motion axis, `prefers-reduced-motion` and `data-mc-static-skeletons` are inherited from the
  pulse for free.

`Skeleton` stays for the eight design-system components that already own a loading state, which
re-implement it on this recipe so the three count-prop names become one.

### 4.3 Fixtures, in order of preference

1. **None.** The component's furniture is the skeleton. Most detail panes, headers and labelled-field
   groups need nothing else.
2. **A fixture snippet over `@magna-carta/fixtures` factories.** Two or three rows of the real row
   component fed by a factory (`aMatter()`, `aDirectoryRecord()`); the factories package grows a
   `presentation` export for shapes that only the UI needs. The fixture lives beside the screen, in
   the code that ships, which is the 2026-08-29 ruling against disposable mockups applied to
   loading.
3. **A count.** For the design-system components that render repeated rows, `placeholderCount` (one
   name, replacing `skeletonRowCount` and the constants) renders that many fixture rows.

### 4.4 Timing rules to record as rulings

- **First read shows the skeleton immediately.** The skeleton is the region's first paint; a delay
  here is a blank frame.
- **A re-read keeps the stale content** and never re-skeletons a region the reader is looking at
  (already the `PagedList` rule; the region makes it structural by rendering `children` whenever
  `loading` turns true after a settle, unless the caller resets the subject).
- **A loading region always has a failure exit.** The wrapper does not render failures itself (the
  `FailureState` family does), but the spec should require every `LoadingRegion` to sit under a
  branch that can settle to a failure with Retry, and the lint rule below can check that the
  enclosing `{#if}` chain names a failure.
- **No minimum display time.** Flicker is prevented by the two rules above, not by holding the bones.

### 4.5 The gate and the gallery

- A **`lint:one-ui` rule**, working name `hand-placed-loading`, on the `hand-composed-modal`
  precedent: `<Skeleton` may appear only inside `packages/design-system`, and `aria-busy` in
  `apps/web` may appear only through `LoadingRegion`. Allowances are declared in
  `tooling/lint-one-ui/registry.json` with a reason, and the standing allowance list is printed on
  every run.
- A **developer-console page**, `loading-states`, beside `table-states` and `failure-states`: each
  archetype's loading state rendered by the real components over fixtures, settled state beside it,
  with the static-skeletons switch, so the owner reviews the shape on the deployed site rather than
  in a mockup.
- The `Feedback/LoadingRegion` story, with the axe pass and the play step asserting `aria-busy`,
  `inert` and the sentence.

### 4.6 Accessibility

Adrian Roselli's review of skeleton screens is the reference: `aria-busy="true"` on the region is
honoured by few screen readers, so the bones are `aria-hidden` and the region carries a
visually-hidden sentence; completion is announced by the state change itself, not by a live region
stacked on top; the bones respect `prefers-reduced-motion`; `cursor: progress` on the region tells
mouse users; and the 3:1 non-text contrast the WCAG 1.4.11 guidance asks of meaningful graphics is
worth checking against `--mc-action-disabled` on each surface token in both modes, since the current
pulse was tuned for subtlety.

## 5. Why not adopt `boneyard-js` outright

It is the one library that genuinely "sees what the final product will be", and the fixture-snippet
idea and the per-breakpoint thinking are worth borrowing. But its bones are pictures of a layout,
and pictures go stale: they do not reflow, they do not follow a density or font change, they need a
browser in the build, and they carry a Playwright dependency into the runtime package graph. In a
repository whose rulings say the frame renders at rest and data fills a shape the reader already has,
the cheapest correct skeleton is the frame with its leaves greyed. If the spike in section 6 shows
fixture authoring is the real cost, `boneyard-js` is the fallback to trial on one screen, and
nothing in the region API above prevents its adapter from being slotted in behind it.

## 6. Proposed spike

Port three surfaces that cover the shapes: a directory pane (a table region), the matter overview
(a labelled-field detail), and the home page (cards). Measure before and after:

| Measure                                                 | Today (three surfaces)  |
| ------------------------------------------------------- | ----------------------- |
| Hand-placed `<Skeleton>` tags                           | 9                       |
| Distinct size-class combinations                        | 6                       |
| Loading regions without `aria-busy` and a sentence      | 2 of 3                  |
| Lines of loading markup                                 | to be counted at spike  |
| Style-recalculation cost of a loading toggle (DevTools) | to be measured at spike |

Success is: zero hand-placed tags, one recipe, every region announced, no measurable main-thread
cost on toggle, and the owner's review of the developer-console page against the settled screens.

## 7. Open questions for the owner

1. **The name.** `LoadingRegion` names the thing; `Placeholder` collides with input ghost text
   (`formatters/placeholder.ts`); `Pending` is shorter but vaguer. Golden rule 12 rules out
   abbreviation, not choice.
2. **Whether the region also owns the failure branch.** A four-state `RecordRegion` (loading,
   failed, empty, settled) with `FailureState` and `EmptyState` slotted would collapse the
   `{#if failure} … {:else if x === null} … {:else if x.length === 0} … {:else}` chain that every pane
   repeats. It is a bigger contract and a bigger migration; this document proposes the two-state
   region first.
3. **Whether the query layer lands first.** ADR-0054 chose TanStack Svelte Query and the app never
   adopted it. The region does not depend on that, but a query layer would make `loading` and the
   stale-on-refetch rule fall out of one place rather than each `$effect`.
4. **The bone contrast.** Keep the deliberately faint pulse, or meet 3:1 per WCAG 1.4.11.

## Sources

Repository: `packages/design-system/CLAUDE.md` (the 2026-06-13 flag), `skeleton.svelte`,
`skeleton.css`, `data-table-grid.svelte`, `apps/web/src/lib/matters/paged-list.svelte.ts`,
`apps/web/src/lib/developer/static-skeletons.ts`, `docs/specs/2026-06-12-page-archetypes.md`,
`docs/specs/2026-06-12-design-language.md`, `docs/conventions/design-corrections.md`,
`docs/research/motion-animation-stack.md`, ADR-0054, ADR-0076.

External: github.com/0xGF/boneyard and boneyard.vercel.app (overview, `/svelte`) ·
registry.npmjs.org/boneyard-js (1.10.0: `playwright` dependency, `svelte >=5.29` peer) ·
github.com/Aejkatappaja/phantom-ui and cssscript.com/skeleton-loader-phantom-ui ·
github.com/ShanukJ/auto-skeleton · github.com/Sinan0333/react-skeletonify · github.com/ingointo/skelon
· github.com/ElemeFE/page-skeleton-webpack-plugin · registry.npmjs.org/svelte-skeleton-loader (0.1.4, 2021) · svelte.dev/docs/svelte/await-expressions and svelte.dev/docs/svelte/svelte-boundary
(experimental async, `pending` on first render only) · adrianroselli.com/2020/11/more-accessible-skeletons
· dev.to/tigt/skeleton-screens-but-fast (`:empty` skeletons, transform-only shimmer) ·
css-tricks.com/building-skeleton-screens-css-custom-properties.
