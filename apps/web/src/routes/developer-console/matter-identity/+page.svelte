<script lang="ts">
  /*
   * Matter identity — the same header band with its identity block at five settings, measured.
   *
   * THE QUESTION. The section navigation now shares the matter's header band, and the band's height
   * is set by whichever column is taller. The identity block is that column today, so the title's
   * step and the number of rows the identity spends are what is left to recover. Two knobs move:
   * the Masthead recipe's density (the title's step) and whether the ledger line keeps a row of its
   * own.
   *
   * THE FLOOR IS REAL AND IT IS SHOWN. The inline-end column is the action control stacked over the
   * section strip, and that stack has a height of its own. Once the identity block is shorter than
   * it, shrinking the title further buys nothing — the band stops responding. The last specimen is
   * there to make that floor visible rather than described, and the caption reports which column is
   * driving each band.
   *
   * Dev builds only, like the developer console itself — behind the import.meta.env.DEV gate.
   */
  import { findMatterFixture } from "$lib/matters/fixtures.ts";
  import { matterRecordFromFixture } from "$lib/matters/matter-record.ts";
  import BandSpecimen from "./band-specimen.svelte";
  import IdentityBand from "./identity-band.svelte";

  // The open litigation fixture: the longest title and fullest citation of the three, so every
  // setting is judged against the matter that crowds it most.
  const fixture = findMatterFixture("matter-fixture-open");
  const matter = fixture === undefined ? null : matterRecordFromFixture(fixture);

  let shippedHeight = $state(0);
  let compactHeight = $state(0);
  let denseHeight = $state(0);
  let foldedHeight = $state(0);
  let inlineHeight = $state(0);
  let unstackedHeight = $state(0);
</script>

<svelte:head><title>Matter identity block · Magna Carta</title></svelte:head>


{#if import.meta.env.DEV}
  <div class="flex min-h-screen flex-col gap-32 bg-surface-default p-24 text-text-default">
    <header class="flex max-w-prose flex-col gap-8">
      <p
        class="text-xs font-semibold text-text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        Developer console
      </p>
      <h1 class="text-2xl font-semibold">Matter identity block</h1>
      <p class="text-sm text-text-muted">
        The section navigation shares the matter's header band now, so the band is as tall as its
        taller column. The identity block is that column, and these are the settings that shorten
        it: the title's step, and whether the ledger line keeps a row of its own.
      </p>
      <p class="text-sm text-text-muted">
        Each caption measures its own band, so the recovered height is read off the rendering rather
        than asserted. Watch for the point where the numbers stop moving: below the height of the
        action control stacked over the section strip, the identity block is no longer what sets the
        band, and a smaller title buys nothing.
      </p>
    </header>

    {#if matter === null}
      <p class="text-sm text-text-muted">The specimen matter fixture is missing.</p>
    {:else}
      <div class="flex flex-col gap-40">
      <BandSpecimen
        name={"Ships today — 2rem title, ledger line on its own row"}
        gains={"The display serif at full masthead scale, and the matter number read first, above the title."}
        costs={"Three stacked rows, and the tallest identity block of the five."}
        height={shippedHeight}
        baselineHeight={shippedHeight}
      >
        <IdentityBand {matter} bind:chromeHeight={shippedHeight} />
      </BandSpecimen>

      <BandSpecimen
        name={"A — title one step down (1.5rem)"}
        gains={"The cheapest change here: one recipe step, nothing moves, and the serif keeps its scale contrast against the citation."}
        costs={"Less presence at the top of the screen; the matter's name stops being the loudest thing on it."}
        height={compactHeight}
        baselineHeight={shippedHeight}
      >
        <IdentityBand {matter} density="compact" bind:chromeHeight={compactHeight} />
      </BandSpecimen>

      <BandSpecimen
        name={"B — title two steps down (1.25rem), tighter stack"}
        gains={"Shorter again, and the three rows start reading as one block rather than three."}
        costs={"At this step the display face is close enough to the citation's size that the scale contrast the masthead register is built on nearly goes."}
        height={denseHeight}
        baselineHeight={shippedHeight}
      >
        <IdentityBand {matter} density="dense" bind:chromeHeight={denseHeight} />
      </BandSpecimen>

      <BandSpecimen
        name={"C — one step down, ledger line folded into the citation"}
        gains={"Removes a whole row rather than shrinking one: the number and seal lead the citation, where they still read first. Keeps a real display title."}
        costs={"The matter number stops being the first thing on the screen and becomes the first thing on the second line."}
        height={foldedHeight}
        baselineHeight={shippedHeight}
      >
        <IdentityBand
        {matter}
        density="compact"
        layout="folded"
        bind:chromeHeight={foldedHeight}
      />
      </BandSpecimen>

      <BandSpecimen
        name={"E — C, with the overflow control moved onto the strip's row"}
        gains={"The only setting here that goes below the floor. Stacked, the inline-end column is the control over the strip and holds the band at 90px no matter how short the identity gets; on one row that column is 41px and the identity block decides the height again."}
        costs={"The control loses its own corner and sits at the end of the section strip, which is a busier neighbourhood for the one gesture that is not navigation."}
        height={unstackedHeight}
        baselineHeight={shippedHeight}
      >
        <IdentityBand
          {matter}
          density="compact"
          layout="folded"
          actions="inline"
          bind:chromeHeight={unstackedHeight}
        />
      </BandSpecimen>

      <BandSpecimen
        name={"D — everything on one line"}
        gains={"The shortest identity block that can exist, and the specimen that shows where the floor is: if this band is no shorter than C, the identity block has stopped setting the height."}
        costs={"No stack at all, so the citation truncates hard and the title competes with it for the same line."}
        height={inlineHeight}
        baselineHeight={shippedHeight}
      >
        <IdentityBand
        {matter}
        density="compact"
        layout="inline"
        bind:chromeHeight={inlineHeight}
      />
      </BandSpecimen>
      </div>
    {/if}
  </div>
{:else}
  <p class="p-16 text-sm text-text-muted">
    The developer console is only available in development builds.
  </p>
{/if}
