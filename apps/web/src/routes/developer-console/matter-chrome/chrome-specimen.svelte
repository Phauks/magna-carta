<script lang="ts">
  /*
   * One labelled arrangement on the matter-chrome comparison: what it is called, what it recovers
   * against today's chrome, and the two sentences that matter — what it buys and what it spends.
   *
   * The recovered height is MEASURED, not asserted. Each candidate binds the real clientHeight of
   * its chrome band and this caption subtracts it from the baseline's, so the number on screen
   * comes from the rendered arrangement at the width the reviewer is looking at. A hand-written
   * "saves about 60px" would be the one claim on this page nobody could check.
   */
  import Badge from "@magna-carta/design-system/badge";
  import type { Snippet } from "svelte";

  let {
    name,
    gains,
    costs,
    chromeHeight,
    baselineHeight,
    widthClass,
    children,
  }: {
    /** What to call this arrangement when asking for it. */
    name: string;
    /** What the arrangement buys. */
    gains: string;
    /** What it spends to buy it. */
    costs: string;
    /** The measured height of this candidate's chrome band. */
    chromeHeight: number;
    /** The measured height of today's chrome, for the difference. */
    baselineHeight: number;
    /** The canvas width the whole page is being read at. */
    widthClass: string;
    children: Snippet;
  } = $props();

  const recovered = $derived(baselineHeight - chromeHeight);
</script>

<figure class="m-0 flex flex-col gap-12">
  <figcaption class="flex flex-col gap-8">
    <div class="flex flex-wrap items-center gap-8">
      <span class="text-sm font-semibold text-text-default">{name}</span>
      {#if recovered > 0}
        <Badge variant="success">{recovered}px recovered</Badge>
      {:else if recovered < 0}
        <Badge variant="warning">{-recovered}px taller</Badge>
      {:else}
        <Badge variant="neutral">Today's chrome</Badge>
      {/if}
      <span class="text-xs text-text-muted">Chrome band {chromeHeight}px</span>
    </div>
    <dl class="m-0 flex flex-col gap-4 text-xs">
      <div class="flex gap-8">
        <dt
          class="w-64 flex-none text-text-subtle uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          Gains
        </dt>
        <dd class="m-0 max-w-prose text-text-muted">{gains}</dd>
      </div>
      <div class="flex gap-8">
        <dt
          class="w-64 flex-none text-text-subtle uppercase"
          style="letter-spacing: var(--mc-tracking-caps)"
        >
          Costs
        </dt>
        <dd class="m-0 max-w-prose text-text-muted">{costs}</dd>
      </div>
    </dl>
  </figcaption>
  <!-- The sunken ground stands in for everything outside the work canvas, so the candidate is
       read against the surface it actually renders on and at the width being reviewed. -->
  <div class="rounded-lg bg-surface-sunken p-24">
    <div class="{widthClass} rounded-md bg-surface-default p-24">
      {@render children()}
    </div>
  </div>
</figure>
