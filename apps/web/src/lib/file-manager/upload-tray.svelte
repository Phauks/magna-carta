<script lang="ts">
  /*
   * The top-bar upload tray — where a transfer shows itself once the panel that started it is gone,
   * and where what this browser sent earlier is still reachable.
   *
   * The frame is the shared one (transfers/transfer-tray.svelte), which is what gives this control
   * its hover label; what is particular to uploads is here.
   *
   * IT IS A TRANSFER MANAGER, DELIBERATELY. Bytes here move through the app's own upload queue, so
   * there is real progress to show: the tally, the failed count, a Retry that sends only what failed
   * back into the same folder, and the way to that folder once the files have landed. The dot on
   * the icon is honest state — something is moving right now, or something finished with a failure
   * the reader has not cleared.
   *
   * A BATCH THAT HAS FINISHED IS A RECORD, NOT A TRANSFER, and the two are kept visibly apart: the
   * live batches lead, then what this browser remembers (transfers/upload-history.svelte.ts), whose
   * rows survive the tab. A remembered file is downloaded from the matter it landed on, which is
   * the same route the file list uses — so "send it to me again" is answered here rather than by a
   * walk through the matter.
   */
  import Ban from "@lucide/svelte/icons/ban";
  import Upload from "@lucide/svelte/icons/upload";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import X from "@lucide/svelte/icons/x";
  import Button from "@magna-carta/design-system/button";
  import Progress from "@magna-carta/design-system/progress";
  import { formatTimeOfDay } from "@magna-carta/design-system/formatters";
  import TransferTray from "$lib/transfers/transfer-tray.svelte";
  import { NO_UPLOADS } from "$lib/transfers/transfers.ts";
  import {
    redownloadableCount,
    uploadHistory,
    type UploadHistoryEntry,
  } from "$lib/transfers/upload-history.svelte.ts";
  import {
    batchCountsText,
    batchPaceText,
    cancelUploadBatch,
    dismissFinishedUploads,
    dismissUploadBatch,
    retryFailedUploads,
    unsentCount,
    uploadBatches,
    uploadsInFlight,
    type UploadBatch,
  } from "./upload-queue.svelte.ts";

  // How many the tray shows. The tray is a glance; a batch's own panel is where each file is read.
  const TRAY_LIMIT = 4;
  // How many remembered batches sit under the live ones. The page below carries the rest.
  const HISTORY_LIMIT = 3;
  // How many of a batch's failures the tray names. The rest are on the Uploads page, in full.
  const FAILURE_LIMIT = 3;

  /** The files that did not go, each with what failed, for the line under a finished batch. */
  function failuresOf(batch: UploadBatch): { name: string; failure: string; reason: string }[] {
    return batch.items
      .filter((item) => item.stage === "failed")
      .map((item) => ({
        name: item.entry.file.name,
        failure: item.failure ?? "Upload failed",
        reason: item.reason ?? item.failure ?? "Upload failed",
      }));
  }

  let open = $state(false);

  const batches = $derived(uploadBatches());
  const inFlight = $derived(uploadsInFlight());
  const needsAttention = $derived(
    inFlight || batches.some((batch) => !batch.running && batch.failed > 0),
  );

  /*
   * What the tray remembers, minus anything a live batch is already showing. A batch that has just
   * finished is BOTH — still in the queue until it is cleared, and already in the history — and
   * listing it twice would make the tray read as two uploads where there was one.
   */
  const remembered = $derived(
    uploadHistory().filter((entry) => !batches.some((batch) => batch.id === entry.id)),
  );

  /** The folder the batch landed in, as the file list opens it. */
  function folderHref(batch: UploadBatch | UploadHistoryEntry): string {
    const base = `/matters/${encodeURIComponent(batch.matterId)}/files`;
    return batch.destinationFolderId === null
      ? base
      : `${base}?folder=${encodeURIComponent(batch.destinationFolderId)}`;
  }

  const finishedCount = $derived(batches.filter((batch) => !batch.running).length);
  const stamp = (value: string): string => formatTimeOfDay(value);
</script>

<TransferTray
  bind:open
  label="Uploads"
  icon={Upload}
  href="/uploads"
  destinationId="uploads"
  marked={needsAttention}
  markedLabel={inFlight ? "Uploading" : "An upload needs attention"}
>
  {#snippet headerActions()}
    {#if finishedCount > 0}
      <Button variant="ghost" size="sm" onclick={dismissFinishedUploads}>Clear Finished</Button>
    {/if}
  {/snippet}
  {#snippet children({ close })}
    {#if batches.length === 0 && remembered.length === 0}
      <p class="text-sm text-text-muted">{NO_UPLOADS}</p>
    {:else}
      {#if batches.length > 0}
        <ul class="flex flex-col gap-8">
          {#each batches.slice(0, TRAY_LIMIT) as batch (batch.id)}
            <li class="flex flex-col gap-4 rounded-md p-8">
              <div class="flex items-start gap-8">
                <span class="min-w-0 grow">
                  <span class="block truncate text-sm font-medium" title={batch.matterTitle}>
                    {batch.matterTitle}
                  </span>
                  <!-- The counts wrap rather than cut: at the tray's width a count that ends in an
                       ellipsis is the one figure the glance came for. -->
                  <span
                    class="block text-xs {batch.failed > 0 && !batch.running
                      ? 'text-status-danger-subtle-foreground'
                      : 'text-text-muted'}"
                  >
                    {batch.destinationLabel} · {batchCountsText(batch)}
                  </span>
                </span>
                {#if batch.running}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Cancel the upload to ${batch.matterTitle}`}
                    title="Cancel Upload"
                    onclick={() => cancelUploadBatch(batch)}
                  >
                    <Ban class="size-16" aria-hidden="true" />
                  </Button>
                {:else}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Clear the upload to ${batch.matterTitle} from the list`}
                    title="Clear"
                    onclick={() => dismissUploadBatch(batch)}
                  >
                    <X class="size-16" aria-hidden="true" />
                  </Button>
                {/if}
              </div>
              <Progress
                value={batch.sentBytes}
                max={Math.max(batch.totalBytes, 1)}
                aria-label={`Progress of the upload to ${batch.matterTitle}`}
              />
              {#if batch.running}
                <span class="block text-xs text-text-subtle tabular-nums">
                  {batchPaceText(batch)}
                </span>
              {:else}
                {@const failures = failuresOf(batch)}
                {#if failures.length > 0}
                  <!-- Each failure says what failed, here as well as on its row: a count alone tells
                       the reader that something went wrong and nothing about what. -->
                  <ul class="flex flex-col gap-4">
                    {#each failures.slice(0, FAILURE_LIMIT) as failed (failed.name)}
                      <li
                        class="truncate text-xs text-status-danger-subtle-foreground"
                        title={failed.reason}
                      >
                        {failed.name} · {failed.failure}
                      </li>
                    {/each}
                    {#if failures.length > FAILURE_LIMIT}
                      <li class="text-xs text-text-muted">
                        And {String(failures.length - FAILURE_LIMIT)} more, on the Uploads page.
                      </li>
                    {/if}
                  </ul>
                {/if}
                <div class="flex flex-wrap items-center gap-8">
                  {#if batch.failed > 0 || unsentCount(batch) > 0}
                    <Button
                      variant="secondary"
                      size="sm"
                      class="whitespace-nowrap"
                      onclick={() => retryFailedUploads(batch)}
                      title={`Send the ${String(batch.failed + unsentCount(batch))} files that did not go`}
                    >
                      <RotateCcw class="size-16" aria-hidden="true" />
                      {batch.failed > 0 ? "Retry Failed" : "Send the Rest"}
                    </Button>
                  {/if}
                  {#if batch.uploaded > 0}
                    <a
                      href={folderHref(batch)}
                      class="text-sm font-medium whitespace-nowrap"
                      style="color: var(--mc-accent-default)"
                      onclick={close}
                    >
                      Open Folder
                    </a>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
        {#if batches.length > TRAY_LIMIT}
          <p class="text-xs text-text-muted">And {String(batches.length - TRAY_LIMIT)} more.</p>
        {/if}
      {/if}
      {#if remembered.length > 0}
        <!-- What this browser remembers. Separated by its own heading rather than mixed in above:
             a remembered batch is a record of files that are now on a matter, and a live one is
             bytes still moving — a single list would leave every row ambiguous about which. -->
        <p class="text-xs font-medium text-text-muted">Earlier</p>
        <ul class="flex flex-col gap-4">
          {#each remembered.slice(0, HISTORY_LIMIT) as entry (entry.id)}
            <li>
              <a
                href={folderHref(entry)}
                class="flex w-full flex-col items-start gap-2 rounded-4 p-8 text-start hover:bg-surface-sunken"
                onclick={close}
              >
                <span class="w-full truncate text-sm font-medium" title={entry.matterTitle}>
                  {entry.matterTitle}
                </span>
                <span class="text-xs text-text-muted">
                  {stamp(entry.finishedAt)} · {String(entry.landed)} of {String(entry.total)} uploaded
                  · {String(redownloadableCount(entry))} downloadable
                </span>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/snippet}
</TransferTray>
