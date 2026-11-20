<script lang="ts">
  /*
   * The second step of a report: the picture of the screen behind the dialog, covers drawn over
   * anything private, and the choice to send without it. Back returns to the words.
   */
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import Label from "@magna-carta/design-system/label";
  import ReportReaders from "./report-readers.svelte";
  import ScreenshotCover from "./screenshot-cover.svelte";
  import type { ReportScreenshot } from "./report-screenshot.svelte.ts";

  let { screenshot, busy }: { screenshot: ReportScreenshot; busy: boolean } = $props();
  const fieldPrefix = $props.id();
</script>

<div class="flex flex-col gap-12">
  {#if screenshot.capturing}
    <p class="text-sm text-text-muted">Taking a picture of the screen.</p>
  {:else if screenshot.picture === null}
    <p class="text-sm text-text-muted">
      This screen couldn't be pictured. The report will be sent without a screenshot.
    </p>
  {:else}
    <span class="flex items-center gap-8">
      <Checkbox id="{fieldPrefix}-include" disabled={busy} bind:checked={screenshot.include} />
      <Label for="{fieldPrefix}-include">Send this screenshot</Label>
    </span>
    {#if screenshot.include}
      <ScreenshotCover picture={screenshot.picture} bind:covers={screenshot.covers} disabled={busy} />
    {/if}
  {/if}
  <ReportReaders />
  <div>
    <Button variant="ghost" size="sm" disabled={busy} onclick={() => (screenshot.step = "describe")}>
      Back
    </Button>
  </div>
</div>
