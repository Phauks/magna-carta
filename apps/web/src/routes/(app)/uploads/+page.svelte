<script lang="ts">
  /*
   * Uploads — every batch this browser tab is sending, laid out in full.
   *
   * The tray is a glance; this is the register. Each batch has its destination, its tally, its
   * rate and time left while it runs, the acts it takes (cancel, retry, send the rest, clear, open
   * the folder), and the same source table the Upload dialog showed — nested, filterable, each row
   * saying where it stands — so what was watched in the panel can be watched here after the panel
   * has gone.
   *
   * LIVE STATE, NOT A REGISTER. An upload is this tab's: the browser's own file handles carry it
   * and cannot survive a reload. So this page reads the upload queue, not the server, and says so
   * in its empty state; the Downloads page beside it is the opposite case, a shelf on the member's
   * record. Mixing the two would leave every row ambiguous about what closing the tab does to it.
   */
  import Ban from "@lucide/svelte/icons/ban";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Progress from "@magna-carta/design-system/progress";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { intakeFolderPaths } from "$lib/file-manager/upload-intake.ts";
  import UploadSourceTable from "$lib/file-manager/upload-source-table.svelte";
  import { formatTimeOfDay } from "@magna-carta/design-system/formatters";
  import {
    batchCountsText,
    batchPaceText,
    cancelUploadBatch,
    dismissFinishedUploads,
    dismissUploadBatch,
    retryFailedUploads,
    unsentCount,
    uploadBatches,
    type UploadBatch,
  } from "$lib/file-manager/upload-queue.svelte.ts";

  const batches = $derived(uploadBatches());
  const finishedCount = $derived(batches.filter((batch) => !batch.running).length);

  /** Every folder open, per batch, so the whole tree reads at once; the reader folds. */
  let expandedByBatch = $state<Record<string, Set<string>>>({});
  function expandedFor(batch: UploadBatch): Set<string> {
    return (expandedByBatch[batch.id] ??= new Set(
      intakeFolderPaths(batch.items.map((item) => item.entry)),
    ));
  }

  function folderHref(batch: UploadBatch): string {
    const base = `/matters/${encodeURIComponent(batch.matterId)}/files`;
    return batch.destinationFolderId === null
      ? base
      : `${base}?folder=${encodeURIComponent(batch.destinationFolderId)}`;
  }

  const startedAt = (batch: UploadBatch): string => formatTimeOfDay(batch.startedAt);
</script>

<svelte:head>
  <title>Uploads · Magna Carta</title>
</svelte:head>

<ScreenHeader title="Uploads" class="mb-24">
  {#snippet actions()}
    {#if finishedCount > 0}
      <Button variant="ghost" onclick={dismissFinishedUploads}>
        <Trash2 class="size-16" aria-hidden="true" />
        Clear Finished
      </Button>
    {/if}
  {/snippet}
</ScreenHeader>

{#if batches.length === 0}
  <EmptyState title="Nothing uploading">
    Files you send to a matter show here while they go and until you clear them, with each file's
    standing, the rate, and the time left. Uploads live in this browser tab: closing the tab ends
    them, and files that had not landed would need to be sent again.
  </EmptyState>
{:else}
  <div class="flex flex-col gap-24">
    {#each batches as batch (batch.id)}
      <section class="flex flex-col gap-8" aria-label={`Upload to ${batch.matterTitle}`}>
        <div class="flex flex-wrap items-baseline gap-8">
          <FieldLabel as="h2">{batch.matterTitle}</FieldLabel>
          <span class="text-sm text-text-muted">{batch.destinationLabel}</span>
          <span class="text-xs text-text-subtle">started {startedAt(batch)}</span>
          <span
            class="ms-auto text-xs {batch.failed > 0 && !batch.running
              ? 'text-status-danger-subtle-foreground'
              : 'text-text-subtle'}"
            role="status"
          >
            {batchCountsText(batch)}
          </span>
        </div>
        <div class="flex min-h-16 items-center gap-8">
          <Progress
            value={batch.sentBytes}
            max={Math.max(batch.totalBytes, 1)}
            aria-label={`Progress of the upload to ${batch.matterTitle}`}
            class="min-w-0 grow"
          />
          {#if batch.running}
            <span class="shrink-0 text-xs text-text-subtle tabular-nums" role="status">
              {batchPaceText(batch)}
            </span>
          {/if}
        </div>
        <div class="flex flex-wrap items-center gap-8">
          {#if batch.running}
            <Button variant="secondary" size="sm" onclick={() => cancelUploadBatch(batch)}>
              <Ban class="size-16" aria-hidden="true" />
              Cancel Upload
            </Button>
          {:else}
            {#if batch.failed > 0 || unsentCount(batch) > 0}
              <Button variant="secondary" size="sm" onclick={() => retryFailedUploads(batch)}>
                <RotateCcw class="size-16" aria-hidden="true" />
                {batch.failed > 0 ? "Retry Failed" : "Send the Rest"}
              </Button>
            {/if}
            {#if batch.uploaded > 0 || batch.alreadyHere > 0}
              <Button variant="secondary" size="sm" href={folderHref(batch)}>
                <FolderOpen class="size-16" aria-hidden="true" />
                Open Folder
              </Button>
            {/if}
            <Button variant="ghost" size="sm" onclick={() => dismissUploadBatch(batch)}>
              Clear
            </Button>
          {/if}
        </div>
        <UploadSourceTable
          entries={batch.items.map((item) => item.entry)}
          progress={batch.progress}
          bind:expanded={() => expandedFor(batch), (next) => (expandedByBatch[batch.id] = next)}
          caption={`Files uploading to ${batch.matterTitle}`}
          selectable={false}
          class="max-h-svh"
        />
      </section>
    {/each}
  </div>
{/if}
