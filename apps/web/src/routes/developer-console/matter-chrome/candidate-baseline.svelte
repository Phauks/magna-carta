<script lang="ts">
  /*
   * What ships today, reproduced from the same parts every other candidate is built from, so the
   * comparison is like for like. Two rows before any content: the masthead, whose inline-end half
   * holds one overflow control and otherwise nothing, and then the section strip on a row of its
   * own with the rule beneath it.
   *
   * The shipped article is at /matters/matter-fixture-open/overview — this is the arrangement, not
   * a second implementation of the screen.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
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

<div class="flex flex-col gap-16" bind:clientHeight={chromeHeight}>
  <Masthead.Root>
    <ChromeHeading {matter} />
    <Masthead.Actions>
      <ChromeActions {matter} />
    </Masthead.Actions>
  </Masthead.Root>
  <ChromeSectionStrip
    {activeSlug}
    {onSelect}
    {maturity}
    class="border-b border-border-default"
  />
</div>

<div class="mt-24">
  {@render content()}
</div>
