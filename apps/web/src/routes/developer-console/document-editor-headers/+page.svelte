<script lang="ts">
  /*
   * Document editor headers — the three candidate bands for the one header the document editor
   * would carry once the rail and the top bar come off it, rendered from the shipping components
   * over one document so they can be compared rather than described.
   *
   * WHAT PROMPTED IT. The editor screen draws the app's rail, the app's top bar and the document's
   * own header, and then gives what is left to the document. The owner's direction is to take the
   * first two away and combine what they carried with what the document's header carries, in one
   * band belonging to this screen alone. Each of the three answers below makes a different choice
   * about what a single band is FOR, and each names, out loud, what it gives up.
   *
   * NOTHING HERE SHIPS AS IT STANDS. This is a decision surface: the bands are candidates, the
   * shipping screen is the real edit route, and the arrangement chosen from this page is what will
   * be built there. Dev builds only, behind the import.meta.env.DEV gate, like the rest of the
   * developer console.
   */
  import type { Snippet } from "svelte";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { DEVELOPER_CONSOLE_BACK } from "$lib/screen/screen-header.ts";
  import HeaderSpecimen from "./header-specimen.svelte";
  import type { EditorSeat, HeaderVariant, SaveState } from "./specimen-document.ts";

  /*
   * Each specimen reports its own band height, measured off the rendered element rather than
   * estimated, and keyed by exactly what makes it that specimen. Every state is measured, not only
   * the ordinary one: a band that grows when a document turns read-only is a defect, and the
   * cheapest way to see it is to have the number beside every state.
   */
  const heights = $state<Record<string, number>>({});

  function specimenKey(variant: HeaderVariant, seat: EditorSeat, saveState: SaveState): string {
    return `${variant}/${seat}/${saveState}`;
  }

  function measured(key: string): string {
    const points = heights[key];
    return points === undefined || points === 0 ? "measuring" : `${String(points)} points tall`;
  }
</script>

<svelte:head><title>Document editor headers · Magna Carta</title></svelte:head>

{#snippet specimen(
  label: string,
  variant: HeaderVariant,
  seat: EditorSeat,
  saveState: SaveState,
)}
  {@const key = specimenKey(variant, seat, saveState)}
  <section class="flex flex-col gap-8">
    <div class="flex flex-wrap items-baseline justify-between gap-8">
      <h4 class="text-sm font-semibold">{label}</h4>
      <p class="text-xs text-text-link">{measured(key)}</p>
    </div>
    <HeaderSpecimen
      {variant}
      {seat}
      {saveState}
      onMeasure={(points) => {
        heights[key] = points;
      }}
    />
  </section>
{/snippet}

{#snippet variantBlock(
  ordinal: string,
  name: string,
  pitch: string,
  prose: Snippet,
  variant: HeaderVariant,
)}
  <div class="flex flex-col gap-24">
    <div class="flex max-w-prose flex-col gap-8">
      <h2 class="text-xl font-semibold">{ordinal}. {name}</h2>
      <p class="text-sm font-semibold text-text-default">{pitch}</p>
      {@render prose()}
    </div>
    <div class="flex flex-col gap-24">
      {@render specimen("Editing, saved", variant, "editing", "saved")}
      {@render specimen("Editing, saving", variant, "editing", "saving")}
      {@render specimen("Read-only: another member holds the lock", variant, "read-only", "saved")}
      {@render specimen("The editor lost its connection", variant, "editing", "disconnected")}
    </div>
  </div>
{/snippet}

{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex max-w-prose flex-col gap-8">
      <ScreenHeader title="Document editor headers" back={DEVELOPER_CONSOLE_BACK} />
      <p class="text-sm text-text-muted">
        Three candidate bands for the document editor once the rail and the top bar come off it, so
        the document takes the whole viewport. Each one combines what the app's top bar carried with
        what the document's own header carried, and each makes a different decision about what a
        single band is for. They are rendered from the shipping components over the same document,
        inside frames of one fixed height, so what a band takes from the document is the visible
        difference between two of them. The figure beside each specimen is read off the rendered
        band, not estimated.
      </p>
      <p class="text-sm text-text-muted">
        Two facts decide most of the arrangement, and both are easy to miss. First, leaving the
        document restores the rail and the bar, so a way back only has to reach ONE app screen and
        everything else follows from there. What a band has to earn is reaching somewhere else
        WITHOUT leaving, which is a weaker need and is what the command palette already answers.
        Second, this band is the only chrome on the screen, so it is where the product's identity
        belongs and the canvas underneath it stays a calm work surface.
      </p>
      <p class="text-sm text-text-muted">
        What is real here: the bands, the breadcrumb, the badges, the Soon affordance, the menus,
        and the second variant's header, which is the product's own screen header. The app menu
        renders the firm's real destination registry. What is a footprint rather than the live
        control: the notification bell, the two transfer registers and the Time Sheet handle, which
        are drawn as the chrome controls they are without their reads, because a gallery about
        where a control sits should not be making authenticated requests. The build chip is the
        real one. The menus open; their rows are inert, since pressing one would leave this page.
      </p>
      <p class="text-sm text-text-muted">
        The save readout is under review as a shape, not as shipping behaviour. The editor writes
        the file itself and reports nothing about its save state to the host today, so wiring this
        would be a message seam on the editor frame. Until that exists, a variant carrying the
        readout either ships it marked as not yet served or ships without it, and that is part of
        what is being chosen here.
      </p>
    </header>

    {#snippet continuousChromeProse()}
      <p class="text-sm text-text-muted">
        <strong>Carries:</strong> everything the top bar carries today. The search, as a glyph rather
        than the wide field; the build chip; notifications; the Time Sheet handle; uploads;
        downloads; the profile menu. From the rail it takes the one thing the rail had at its head:
        the mark, which goes Home.
      </p>
      <p class="text-sm text-text-muted">
        <strong>Drops:</strong> the search field's width, which the document's name takes, leaving the
        glyph and the keyboard chord to open the palette. The New seam goes too: it renders nothing
        today, and making a record is not something a member does from inside a document.
      </p>
      <p class="text-sm text-text-muted">
        <strong>The way back:</strong> two named exits at the head of the row. The mark goes Home, and
        the link beside it goes to this matter's files, named by the matter. Either one restores the
        rail and the bar; anywhere else is the palette.
      </p>
      <p class="text-sm text-text-muted">
        <strong>What it costs:</strong> the band is pinned to the top bar's own height, which makes it
        the tallest fixed band of the three, and it spends its whole inline end on the application,
        so the document's name is the first thing to truncate as the canvas narrows. It also reads
        as the app's bar that happens to name a document, which is close to the opposite of what a
        focus surface is for. Two of its parts are drawn for the light work surface and have no ink
        register: the product's own back control, which is why the way back here is a chrome link
        instead, and the Soon mark beside Share, which needs checking in both modes before this
        variant could ship.
      </p>
    {/snippet}
    {@render variantBlock(
      "One",
      "Continuous chrome",
      "The app's own top bar, with the document seated in it. Nothing the bar carried is given up.",
      continuousChromeProse,
      "continuous-chrome",
    )}

    {#snippet documentMastheadProse()}
      <p class="text-sm text-text-muted">
        <strong>Carries:</strong> the header the document already has, unchanged in kind. The named
        way back, the title in the display serif, the citation line beneath it. From the top bar it
        keeps three: the search glyph, the Time Sheet handle, and the profile menu, which is the
        only door to Account and to signing out once the rail is gone.
      </p>
      <p class="text-sm text-text-muted">
        <strong>Drops from the band:</strong> the notification bell, the upload tray, the download tray
        and the build chip. Each is a register about the application rather than about the document,
        and every one of them is back in view the moment the member leaves. What is genuinely lost
        is the tally on a failed upload while somebody drafts for an hour, and that is the honest
        argument against this variant.
      </p>
      <p class="text-sm text-text-muted">
        <strong>The way back:</strong> the product's own back control, naming the matter, in the place
        every other screen in the product puts it. The rest of the app is the palette and the
        destinations in the account menu.
      </p>
      <p class="text-sm text-text-muted">
        <strong>What it costs:</strong> height, and it is the tallest of the three because it spends
        two lines on the document. What it buys is that there is nothing new to learn and nothing
        new to build: a member arriving here meets the same header they meet on every other screen,
        and a correction made to that header is made once for the whole product.
      </p>
    {/snippet}
    {@render variantBlock(
      "Two",
      "Document masthead",
      "Keep the header the document already has, and fold what survives of the app into its action row.",
      documentMastheadProse,
      "document-masthead",
    )}

    {#snippet pathBarProse()}
      <p class="text-sm text-text-muted">
        <strong>Carries:</strong> the path, from the docket down to this document, with the document as
        its leaf. Beside it the version number, the save readout, the state badge, the Time Sheet
        handle, the search glyph and the profile menu. The notification bell, the two transfer
        registers and the build chip merge into one tray.
      </p>
      <p class="text-sm text-text-muted">
        <strong>Drops:</strong> the file's size and the instant it was last written. Both are facts
        about the stored file and belong to the file manager's record of it; a member typing in the
        document needs to know which version they are on and whether it is saved.
      </p>
      <p class="text-sm text-text-muted">
        <strong>The way back:</strong> the ladder itself. Not one exit but four, each naming where it
        lands: the docket, the matter, the matter's files, and the folder the document sits in. It
        is the only variant where a member can see where the document IS rather than only that
        there is a way out, and the destinations menu at the head of the row stands in for the rail.
      </p>
      <p class="text-sm text-text-muted">
        <strong>What it costs:</strong> the document's name is a breadcrumb leaf in the small sans
        step, so the document loses the masthead register entirely and the band reads as navigation
        rather than as a document's header. A deeper folder path folds its middle behind the
        ellipsis. And one merged tray means a failed upload, an unread notice and a finished
        download all ask for attention through a single glyph, which is the ambiguity the two
        transfer trays were deliberately split to avoid.
      </p>
    {/snippet}
    {@render variantBlock(
      "Three",
      "Path bar",
      "The path is the header: every rung between the docket and this document is on the row.",
      pathBarProse,
      "path-bar",
    )}

    <div class="flex max-w-prose flex-col gap-8">
      <h2 class="text-xl font-semibold">What is missing from the design system either way</h2>
      <p class="text-sm text-text-muted">
        Two gaps showed up while these were built, and both bind whichever variant is chosen. The
        product's back control wears the masthead eyebrow register, which is drawn for the light
        work surface, so an ink band cannot carry it and the first variant uses a chrome link
        instead. The Soon mark has the same problem: the badge is a work-surface component, so a
        designed-but-unwired control on an ink band has no mark that is certain to read in both
        modes. Both are small additions to the components rather than anything a screen should
        settle for itself.
      </p>
    </div>
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    This review surface is only available in development builds.
  </p>
{/if}
