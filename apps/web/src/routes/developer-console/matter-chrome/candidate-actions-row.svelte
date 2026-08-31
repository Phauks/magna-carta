<script lang="ts">
  /*
   * Candidate A — the sections move onto the title's own row, packed to the inline end, with the
   * action cluster closing the row. The strip's row disappears entirely and the rule drops to the
   * base of the whole band.
   *
   * The trade this arrangement makes: tabs and title now compete for one row, so the strip is put
   * on the compact density and maturity reads as a dot rather than a labelled badge. That is what
   * buys enough width for a useful number of sections before More takes the tail. Nothing floats
   * against a track here, so the current section is marked by fill, not by the gold bar — an
   * underline with no rule beneath it marks nothing.
   */
  import type { Snippet } from "svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import ChromeActions from "./chrome-actions.svelte";
  import ChromeHeading from "./chrome-heading.svelte";
  import ChromeSectionStrip from "./chrome-section-strip.svelte";

  let {
    matter,
    activeSlug,
    onSelect,
    content,
    showMaturity = true,
    chromeHeight = $bindable(0),
  }: {
    matter: MatterRecord;
    activeSlug: string;
    onSelect: (slug: string) => void;
    content: Snippet;
    /** False reads the arrangement as it will be once every section has graduated. */
    showMaturity?: boolean;
    chromeHeight?: number;
  } = $props();

  const maturity = $derived(showMaturity ? "dot" : "none");
</script>

<div
  class="flex items-center gap-16 border-b border-border-default pb-16"
  bind:clientHeight={chromeHeight}
>
  <div class="min-w-0 flex-1">
    <ChromeHeading {matter} />
  </div>
  <div class="flex min-w-0 flex-1 items-center justify-end gap-8">
    <ChromeSectionStrip
      {activeSlug}
      {onSelect}
      density="compact"
      align="end"
      {maturity}
      mark="pill"
      class="min-w-0 flex-1"
    />
    <ChromeActions {matter} />
  </div>
</div>

<div class="mt-24">
  {@render content()}
</div>
