<script lang="ts">
  /*
   * Matter chrome — the arrangements that could hold the section navigation, side by side.
   *
   * THE QUESTION THIS PAGE EXISTS TO SETTLE. A matter screen spends two rows before any content:
   * the masthead, whose inline-end half carries one overflow control and otherwise nothing, and
   * then the section strip on a row of its own. The navigation could move into that empty half.
   * Four arrangements do it four ways, and today's chrome is rendered from the same parts beside
   * them so the comparison is like for like.
   *
   * It is a SELECTION round, not a build: nothing under matters/[id] changes shape until one of
   * these is chosen, and when one is, its arrangement is folded into matter-header.svelte /
   * matter-section-nav.svelte and the candidates here are deleted in the same commit. What keeps
   * that honest is that every candidate is composed from the real design system, the real matter
   * fixture, the real section registry, and the same fold arithmetic the shipped strip uses — so
   * choosing one is adopting an arrangement, never translating a drawing.
   *
   * Read it at more than one width. The strip's fold is measured, not a breakpoint, so how many
   * sections survive into the row is the first thing that changes between a wide desk and a laptop
   * — and it is the main risk in every arrangement that puts tabs beside the title.
   *
   * Dev builds only, like the developer console itself — behind the import.meta.env.DEV gate.
   */
  import Badge from "@magna-carta/design-system/badge";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import SectionStub from "$lib/matters/section-stub.svelte";
  import { findMatterFixture } from "$lib/matters/fixtures.ts";
  import { matterRecordFromFixture } from "$lib/matters/matter-record.ts";
  import { matterSections } from "$lib/matters/sections.ts";
  import CandidateActionsRow from "./candidate-actions-row.svelte";
  import CandidateBaseline from "./candidate-baseline.svelte";
  import CandidateSectionRail from "./candidate-section-rail.svelte";
  import CandidateStackedRight from "./candidate-stacked-right.svelte";
  import CandidateWorkingHeader from "./candidate-working-header.svelte";
  import ChromeSpecimen from "./chrome-specimen.svelte";

  // The open litigation fixture: the longest title and the fullest citation line of the three, so
  // every arrangement is judged against the matter that crowds it most.
  const fixture = findMatterFixture("matter-fixture-open");
  const matter = fixture === undefined ? null : matterRecordFromFixture(fixture);

  // One current section across every specimen, so changing it shows five arrangements answering
  // the same navigation at once.
  let activeSlug = $state("files");
  const activeSection = $derived(matterSections.find((section) => section.slug === activeSlug));

  /*
   * The canvas widths worth reading this at. The fold is driven by the strip's own measurement,
   * so a narrower frame is the only way to see where each arrangement gives up. "Full" is this
   * browser window; the rest name the work canvas widths a member actually gets on a laptop after
   * the shell's sidebar takes its share.
   */
  const CANVAS_WIDTHS = [
    { value: "full", label: "Full", widthClass: "w-full" },
    { value: "wide", label: "1280", widthClass: "w-full max-w-7xl" },
    { value: "laptop", label: "1024", widthClass: "w-full max-w-5xl" },
    { value: "narrow", label: "896", widthClass: "w-full max-w-4xl" },
  ] as const;

  let canvasWidth = $state<string>("full");
  /*
   * The maturity marks are transitional: every section eventually reaches "ready" and wears no
   * mark at all. They are also expensive — a labelled badge costs each tab about as much width as
   * its own label — so an arrangement judged only with them on is judged against chrome that is
   * on its way out. This reads any arrangement both ways.
   */
  let maturityMarks = $state<string>("designed");
  const showMaturity = $derived(maturityMarks === "designed");
  const widthClass = $derived(
    CANVAS_WIDTHS.find((entry) => entry.value === canvasWidth)?.widthClass ?? "w-full",
  );

  // Every candidate reports the real height of its chrome band; the specimen captions turn those
  // into the difference against today.
  let baselineHeight = $state(0);
  let actionsRowHeight = $state(0);
  let stackedRightHeight = $state(0);
  let workingHeaderHeight = $state(0);
  let sectionRailHeight = $state(0);
</script>

<svelte:head><title>Matter chrome arrangements · Magna Carta</title></svelte:head>

{#snippet sectionContent()}
  {#if activeSection}
    <SectionStub section={activeSection} />
  {/if}
{/snippet}

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex max-w-prose flex-col gap-8">
      <p
        class="text-xs font-semibold text-text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        Developer console
      </p>
      <h1 class="text-2xl font-semibold">Matter chrome arrangements</h1>
      <p class="text-sm text-text-muted">
        Today a matter spends two rows before its content, and the inline-end half of the masthead
        holds one overflow control and nothing else. Each arrangement below moves the section
        navigation into that space a different way, and today's chrome is reproduced from the same
        parts at the top for comparison. Every candidate is composed from the shipping design
        system and the real section registry, so picking one adopts an arrangement rather than
        commissioning a translation of it.
      </p>
      <p class="text-sm text-text-muted">
        The recovered height in each caption is measured from the rendered band at the width in
        force, not asserted. Change the width and the numbers change with it. Read every
        arrangement with the maturity marks off as well: a labelled badge costs a tab roughly its
        own label again in width, and those marks disappear as sections graduate, so an
        arrangement that only works with them on is being judged against chrome that is leaving.
      </p>
      <p class="text-sm text-text-muted">
        Read them at 1024 before deciding. Every arrangement that puts sections beside the title
        takes width away from it, and this matter's title is long enough to wrap when it only has
        half a row — at which point the band grows a line and the arrangement is TALLER than the
        chrome it replaced. The measured caption says so when it happens. That is the question this
        page exists to answer, and it is not visible at desk width.
      </p>
    </header>

    {#if matter === null}
      <p class="text-sm text-text-muted">
        The specimen matter fixture is missing, so there is nothing to arrange.
      </p>
    {:else}
      <div class="flex flex-wrap items-end gap-24">
        <div class="flex flex-col gap-8">
          <p
            class="text-xs font-semibold text-text-subtle uppercase"
            style="letter-spacing: var(--mc-tracking-caps)"
          >
            Canvas width
          </p>
          <Tabs.Root bind:value={canvasWidth}>
            <Tabs.List>
              {#each CANVAS_WIDTHS as width (width.value)}
                <Tabs.Trigger value={width.value}>{width.label}</Tabs.Trigger>
              {/each}
            </Tabs.List>
          </Tabs.Root>
        </div>
        <div class="flex flex-col gap-8">
          <p
            class="text-xs font-semibold text-text-subtle uppercase"
            style="letter-spacing: var(--mc-tracking-caps)"
          >
            Maturity marks
          </p>
          <Tabs.Root bind:value={maturityMarks}>
            <Tabs.List>
              <Tabs.Trigger value="designed">As designed</Tabs.Trigger>
              <Tabs.Trigger value="none">All graduated</Tabs.Trigger>
            </Tabs.List>
          </Tabs.Root>
        </div>
        <div class="flex flex-col gap-8">
          <p
            class="text-xs font-semibold text-text-subtle uppercase"
            style="letter-spacing: var(--mc-tracking-caps)"
          >
            Current section
          </p>
          <p class="flex items-center gap-8 text-sm text-text-muted">
            {activeSection?.label}
            <Badge variant="neutral">Select a tab in any arrangement</Badge>
          </p>
        </div>
      </div>

      <div class="flex flex-col gap-40">
        <ChromeSpecimen
          name="Today — masthead over a full-width strip"
          gains="Nothing competes for width: every core section is in the row at any canvas size,
                 the strip sits on its own rule, and the gold bar marks the current section against
                 that rule."
          costs="Two rows of chrome before content, and the inline-end half of the masthead is
                 empty on every matter screen."
          chromeHeight={baselineHeight}
          {baselineHeight}
          {widthClass}
        >
          <CandidateBaseline
            {matter}
            {activeSlug}
            onSelect={(slug) => (activeSlug = slug)}
            content={sectionContent}
            {showMaturity}
            bind:chromeHeight={baselineHeight}
          />
        </ChromeSpecimen>

        <ChromeSpecimen
          name="A — sections on the title's row"
          gains="The strip's row is gone and the rule drops to the base of one band. The masthead
                 keeps its full ceremony."
          costs="Tabs and title share a row, so the strip goes compact and maturity reads as a dot.
                 The real cost is narrow: the title loses half its width and wraps, and a wrapped
                 title makes this band taller than today's two rows."
          chromeHeight={actionsRowHeight}
          {baselineHeight}
          {widthClass}
        >
          <CandidateActionsRow
            {matter}
            {activeSlug}
            onSelect={(slug) => (activeSlug = slug)}
            content={sectionContent}
            {showMaturity}
            bind:chromeHeight={actionsRowHeight}
          />
        </ChromeSpecimen>

        <ChromeSpecimen
          name="B — actions above, sections beneath, both at the inline end"
          gains="The strip's row is gone and the strip still gets the comfortable density with
                 labelled maturity badges, because it no longer shares a row with the actions."
          costs="Comfortable tabs in half a row means most sections fold into More — fewer stay
                 visible here than in A, until the maturity badges graduate away. It wraps the
                 title narrow for the same reason A does. The band also reads as two rows of chrome
                 on both sides, and the current section is marked by fill rather than by the gold
                 bar: there is no rule under it to draw on."
          chromeHeight={stackedRightHeight}
          {baselineHeight}
          {widthClass}
        >
          <CandidateStackedRight
            {matter}
            {activeSlug}
            onSelect={(slug) => (activeSlug = slug)}
            content={sectionContent}
            {showMaturity}
            bind:chromeHeight={stackedRightHeight}
          />
        </ChromeSpecimen>

        <ChromeSpecimen
          name="C — one working line: identity, sections, actions"
          gains="The most vertical space of any arrangement here: identity, navigation and actions
                 all land on a single line."
          costs="The matter screen stops carrying the display serif at masthead scale, which is the
                 design language's ceremonial edge, and the citation line truncates. In exchange it
                 is the only arrangement here whose height does not move with the canvas: the band
                 is one line at every width."
          chromeHeight={workingHeaderHeight}
          {baselineHeight}
          {widthClass}
        >
          <CandidateWorkingHeader
            {matter}
            {activeSlug}
            onSelect={(slug) => (activeSlug = slug)}
            content={sectionContent}
            {showMaturity}
            bind:chromeHeight={workingHeaderHeight}
          />
        </ChromeSpecimen>

        <ChromeSpecimen
          name="D — sections as a rail beside the work"
          gains="The strip's row is recovered and nothing folds: all fourteen sections are readable
                 at once, More disappears, and a fifteenth section costs a row rather than a place
                 in a menu."
          costs="Horizontal canvas on every section page, a second vertical rail beside the shell's
                 own, and the masthead's empty inline-end half is still empty. It is the only
                 arrangement that answers the crowding question by not competing for the row at
                 all, which is also why it does not use the space the question was about."
          chromeHeight={sectionRailHeight}
          {baselineHeight}
          {widthClass}
        >
          <CandidateSectionRail
            {matter}
            {activeSlug}
            onSelect={(slug) => (activeSlug = slug)}
            content={sectionContent}
            {showMaturity}
            bind:chromeHeight={sectionRailHeight}
          />
        </ChromeSpecimen>
      </div>
    {/if}
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    The developer console is only available in development builds.
  </p>
{/if}
