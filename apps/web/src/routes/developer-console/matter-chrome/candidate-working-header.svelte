<script lang="ts">
  /*
   * Candidate C — the whole chrome on one line. The identity block compacts: the ledger number,
   * the title at the working scale, the status seal, and the citation trailing behind them,
   * truncating rather than wrapping. Sections and the action cluster close the line.
   *
   * This recovers the most vertical space of any arrangement here, and it is the only one that
   * gives something real up: the masthead's display serif at masthead scale is the design
   * language's ceremonial edge, and a matter screen would stop carrying it. Worth seeing beside
   * the others precisely because that is a judgment, not an oversight.
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
  class="flex items-center gap-16 border-b border-border-default pb-12"
  bind:clientHeight={chromeHeight}
>
  <div class="min-w-0 flex-1">
    <ChromeHeading {matter} scale="compact" />
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
