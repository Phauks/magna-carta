<script lang="ts">
  /*
   * Candidate D — the sections leave the header entirely and stand as a rail beside the work. The
   * masthead keeps the full width it has today, including the empty inline-end half, and the
   * strip's row is still recovered.
   *
   * This is the only arrangement here that does not fold: all fourteen sections are readable at
   * once, More disappears, and a fifteenth section costs a row rather than a place in a menu. It
   * pays in horizontal canvas on every section page, and it puts a second vertical rail beside the
   * shell's own — worth looking at directly rather than reasoning about.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import type { Snippet } from "svelte";
  import type { MatterRecord } from "$lib/matters/matter-record.ts";
  import ChromeActions from "./chrome-actions.svelte";
  import ChromeHeading from "./chrome-heading.svelte";
  import ChromeSectionRail from "./chrome-section-rail.svelte";

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

<div class="border-b border-border-default pb-16" bind:clientHeight={chromeHeight}>
  <Masthead.Root>
    <ChromeHeading {matter} />
    <Masthead.Actions>
      <ChromeActions {matter} />
    </Masthead.Actions>
  </Masthead.Root>
</div>

<div class="mt-24 flex items-start gap-24">
  <ChromeSectionRail {activeSlug} {onSelect} {maturity} class="flex-none" />
  <div class="min-w-0 flex-1">
    {@render content()}
  </div>
</div>
