<script lang="ts">
  /*
   * Candidate B — the empty inline-end half becomes a column of its own: the action cluster on the
   * title's row, the section strip beneath it, level with the citation line. The masthead keeps
   * every bit of its ceremony and the strip's own row still disappears.
   *
   * Against candidate A this buys the strip the full comfortable density with labelled maturity
   * badges, because it no longer shares a row with the actions. What it costs is that the band now
   * reads as two rows of chrome on both sides rather than a title with navigation beside it.
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

  const maturity = $derived(showMaturity ? "badge" : "none");
</script>

<div
  class="flex items-start gap-16 border-b border-border-default pb-8"
  bind:clientHeight={chromeHeight}
>
  <div class="min-w-0 flex-1">
    <ChromeHeading {matter} />
  </div>
  <div class="flex min-w-0 flex-1 flex-col items-end gap-12">
    <ChromeActions {matter} />
    <ChromeSectionStrip {activeSlug} {onSelect} {maturity} align="end" mark="pill" class="w-full" />
  </div>
</div>

<div class="mt-24">
  {@render content()}
</div>
