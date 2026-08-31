<script lang="ts">
  /*
   * The File Analysis view's own header, kept deliberately thin. The table below is an ordinary
   * file table and its Safety column already filters — so no severity or kind buttons live up
   * here, where they would say the same thing twice. What remains is what only this view has:
   * the count of findings shown, the door into the ignored set, and the report.
   *
   * ONE REPORT, TWO WAYS OUT. Copy and Download render from the same text, so what somebody pastes
   * into an email and what they attach to it cannot disagree.
   *
   * IGNORING IS PER ISSUE, not per file, and every ignore is individually reversible. The ignored
   * set can be viewed and taken back the same way it was made.
   */
  import Button from "@magna-carta/design-system/button";
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Eye from "@lucide/svelte/icons/eye";
  import { countPhrase } from "./file-manager-vocabulary.ts";

  let {
    shownCount,
    showingIgnored = $bindable(false),
    ignoredCount,
    onCopyReport,
    onDownloadReport,
  }: {
    shownCount: number;
    showingIgnored?: boolean;
    ignoredCount: number;
    onCopyReport: () => void;
    onDownloadReport: () => void;
  } = $props();
</script>

<div class="flex flex-wrap items-center gap-8 border-b border-border-default px-12 py-8">
  <span class="text-xs text-text-muted">
    {showingIgnored
      ? countPhrase(shownCount, "ignored issue")
      : countPhrase(shownCount, "open issue")}
  </span>

  <div class="ms-auto flex items-center gap-4">
    {#if ignoredCount > 0 || showingIgnored}
      <Button
        variant="ghost"
        size="sm"
        aria-pressed={showingIgnored}
        onclick={() => (showingIgnored = !showingIgnored)}
      >
        {#if showingIgnored}
          <Eye class="size-16" aria-hidden="true" />
          Show Open Issues
        {:else}
          <EyeOff class="size-16" aria-hidden="true" />
          Show {countPhrase(ignoredCount, "Ignored Issue")}
        {/if}
      </Button>
    {/if}
    <!-- Small icon buttons, out of the reading's way: the findings are what the reader came for. -->
    <Button
      variant="ghost"
      size="icon"
      title="Copy every issue shown"
      aria-label="Copy every issue shown"
      onclick={onCopyReport}
    >
      <Copy class="size-16" aria-hidden="true" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      title="Download every issue shown"
      aria-label="Download every issue shown"
      onclick={onDownloadReport}
    >
      <Download class="size-16" aria-hidden="true" />
    </Button>
  </div>
</div>
