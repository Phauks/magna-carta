<script lang="ts">
  /*
   * A capability that is designed and not yet served, rendered the way the standing rule asks: its
   * real control, disabled, with the Soon mark and one line naming what it waits on. The control is
   * drawn rather than hidden so the shape of the capability is visible, and it cannot be mistaken
   * for working.
   *
   * Every capability whose engine is not wired yet renders through this one component, so the
   * seven of them cannot drift into seven different ways of saying the same thing. A capability
   * graduates by swapping its `panel` in its own module file for a real one.
   */
  import type { Snippet } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";

  let {
    action,
    awaiting,
    findings,
  }: {
    /** The run control's real words, e.g. "Convert the Selection". */
    action: string;
    /** What it waits on, as a noun phrase: "file conversion". */
    awaiting: string;
    /** Anything already known about this file that belongs above the control. */
    findings?: Snippet;
  } = $props();
</script>

<div class="flex flex-col gap-16">
  {#if findings}{@render findings()}{/if}
  <SoonAffordance reason={awaiting} reasonPlacement="line">
    {#snippet control(soon)}
      <Button variant="primary" {...soon}>{action}</Button>
    {/snippet}
  </SoonAffordance>
</div>
