<script lang="ts">
  /*
   * The File Analysis view's own header. It counts by SEVERITY, not by how many files have anything
   * at all, and the counts ARE the filters: pressing one narrows the view to that band and shows it
   * as active. A band with nothing in it is absent rather than a dead control.
   *
   * ONE REPORT, TWO WAYS OUT. Copy and Download render from the same text, so what somebody pastes
   * into an email and what they attach to it cannot disagree.
   *
   * IGNORING IS PER ISSUE, not per file, and every ignore is individually reversible. The ignored
   * set can be viewed and taken back the same way it was made.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import { statusEntry } from "@magna-carta/design-system/status-register";
  import Copy from "@lucide/svelte/icons/copy";
  import Download from "@lucide/svelte/icons/download";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Eye from "@lucide/svelte/icons/eye";
  import {
    ISSUE_KINDS,
    SEVERITY_BAND_KEYS,
    countPhrase,
    type IssueKind,
    type SeverityBandKey,
  } from "./file-manager-vocabulary.ts";

  let {
    countsByBand,
    countsByKind,
    activeBand = $bindable(null),
    activeKind = $bindable(null),
    showingIgnored = $bindable(false),
    ignoredCount,
    onCopyReport,
    onDownloadReport,
  }: {
    countsByBand: Record<SeverityBandKey, number>;
    countsByKind: Map<IssueKind, number>;
    activeBand?: SeverityBandKey | null;
    activeKind?: IssueKind | null;
    showingIgnored?: boolean;
    ignoredCount: number;
    onCopyReport: () => void;
    onDownloadReport: () => void;
  } = $props();
</script>

<div class="flex flex-wrap items-center gap-8 border-b border-border-default px-12 py-8">
  {#each SEVERITY_BAND_KEYS as band (band)}
    {#if countsByBand[band] > 0}
      <Button
        variant={activeBand === band ? "secondary" : "ghost"}
        size="sm"
        aria-pressed={activeBand === band}
        title={statusEntry(band).meaning}
        onclick={() => (activeBand = activeBand === band ? null : band)}
      >
        <Badge variant={statusEntry(band).tone}>{countsByBand[band]}</Badge>
        {statusEntry(band).label}
      </Button>
    {/if}
  {/each}

  {#each [...countsByKind] as [kind, count] (kind)}
    <Button
      variant={activeKind === kind ? "secondary" : "ghost"}
      size="sm"
      aria-pressed={activeKind === kind}
      onclick={() => (activeKind = activeKind === kind ? null : kind)}
    >
      {ISSUE_KINDS[kind].label}
      <span class="text-text-muted">{count}</span>
    </Button>
  {/each}

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
