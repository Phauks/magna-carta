<script lang="ts">
  /*
   * The top-bar upload tray — where a transfer shows itself once the panel that started it is gone.
   *
   * The download tray beside it is the way back to what the platform MADE for a member; this is the
   * way to what the member is SENDING. They are kept as two trays rather than one because they hold
   * different kinds of thing: the shelf is a register on the member's record that survives a reload
   * and lasts a week, while an upload is live state in this tab that dies with it. One list mixing a
   * durable record with a transient transfer would make every item ambiguous about what closing the
   * tab does to it.
   *
   * IT IS A TRANSFER MANAGER, DELIBERATELY. Bytes here move through the app's own upload queue, so
   * there is real progress to show: the tally, the failed count, a Retry that sends only what failed
   * back into the same folder, and the way to that folder once the files have landed. The dot on
   * the icon is honest state — it means something is moving right now, or something finished with a
   * failure the reader has not cleared.
   */
  import Ban from "@lucide/svelte/icons/ban";
  import Upload from "@lucide/svelte/icons/upload";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import X from "@lucide/svelte/icons/x";
  import Button from "@magna-carta/design-system/button";
  import * as Popover from "@magna-carta/design-system/popover";
  import Progress from "@magna-carta/design-system/progress";
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

  /** The folder the batch landed in, as the file list opens it. */
  function folderHref(batch: UploadBatch): string {
    const base = `/matters/${encodeURIComponent(batch.matterId)}/files`;
    return batch.destinationFolderId === null
      ? base
      : `${base}?folder=${encodeURIComponent(batch.destinationFolderId)}`;
  }

  const finishedCount = $derived(batches.filter((batch) => !batch.running).length);
</script>

<Popover.Root bind:open>
  <Popover.Trigger class="mc-top-bar-icon-button relative" aria-label="Uploads">
    <Upload class="size-16" aria-hidden="true" />
    {#if needsAttention}
      <!-- Real state: bytes are moving, or a batch finished with something that did not go. -->
      <span
        class="absolute end-4 top-4 block size-8 rounded-full"
        style="background: var(--mc-accent-default)"
        aria-hidden="true"
      ></span>
      <span class="sr-only">{inFlight ? "Uploading" : "An upload needs attention"}</span>
    {/if}
  </Popover.Trigger>
  <Popover.Content
    align="end"
    class="flex flex-col gap-8"
    style="inline-size: var(--mc-size-popover)"
  >
    <div class="flex items-center gap-8">
      <p class="text-sm font-medium">Uploads</p>
      {#if finishedCount > 0}
        <Button variant="ghost" size="sm" class="ms-auto" onclick={dismissFinishedUploads}>
          Clear Finished
        </Button>
      {/if}
    </div>
    {#if batches.length === 0}
      <p class="text-sm text-text-muted">Nothing uploading.</p>
      <p class="text-xs text-text-muted">
        Files you upload show their progress here, and keep going while you work elsewhere.
      </p>
    {:else}
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
                    onclick={() => (open = false)}
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
    <a
      href="/uploads"
      class="text-sm font-medium"
      style="color: var(--mc-accent-default)"
      onclick={() => (open = false)}
    >
      Open uploads
    </a>
  </Popover.Content>
</Popover.Root>
