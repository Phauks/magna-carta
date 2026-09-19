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
   * TWO HALVES, KEPT VISIBLY APART. A transfer is this tab's: the browser's own file handles carry
   * it and cannot survive a reload, so the batches above read the upload queue and nothing else.
   * What a finished batch DID is not a transfer, though — it is a list of names, a matter, a folder
   * and the file each one became — so it is remembered per browser
   * ($lib/transfers/upload-history.svelte.ts) and read below, where every file that landed can be
   * downloaded again from the matter it landed on. Before that record existed this screen answered
   * "nothing uploading" to "where is the thing I sent yesterday", which is true and useless.
   *
   * THE TABLE STANDS WHETHER OR NOT ANYTHING IS UPLOADING. With nothing in the air and nothing
   * remembered, the register still draws the header row a remembered batch opens to, over an empty
   * body carrying the one line that says which kind of nothing it is. A member arriving here before
   * their first upload meets the shape their files will arrive in.
   */
  import Ban from "@lucide/svelte/icons/ban";
  import Download from "@lucide/svelte/icons/download";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Progress from "@magna-carta/design-system/progress";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { intakeFolderPaths } from "$lib/file-manager/upload-intake.ts";
  import UploadSourceTable from "$lib/file-manager/upload-source-table.svelte";
  import { formatBytes } from "$lib/file-manager/file-rows.ts";
  import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";
  import { NO_UPLOADS } from "$lib/transfers/transfers.ts";
  import {
    clearUploadHistory,
    forgetUpload,
    uploadHistory,
    type UploadHistoryEntry,
    type UploadHistoryFile,
  } from "$lib/transfers/upload-history.svelte.ts";
  import { formatInstant, formatTimeOfDay } from "@magna-carta/design-system/formatters";
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

  const everyBatch = $derived(uploadBatches());
  const finishedCount = $derived(everyBatch.filter((batch) => !batch.running).length);

  /*
   * What this browser remembers, minus anything the queue above is still showing. A batch that has
   * just finished is both a live row (until it is cleared) and a remembered one; listing it in both
   * halves would read as two uploads where there was one.
   */
  const everyRemembered = $derived(
    uploadHistory().filter((entry) => !everyBatch.some((batch) => batch.id === entry.id)),
  );

  /*
   * Narrowing the register. Every batch is already in this tab — that is the whole nature of this
   * screen — so the query runs on every keystroke and never leaves the machine. It reads the matter
   * a batch is going to and the folder it lands in, because "where was I sending that" is the
   * question somebody watching four uploads at once actually has.
   */
  let searchText = $state("");
  let appliedSearch = $state("");
  const batchSearch = $derived(appliedSearch.trim().toLowerCase());
  const batches = $derived(
    batchSearch === ""
      ? everyBatch
      : everyBatch.filter((batch) =>
          `${batch.matterTitle} ${batch.destinationLabel}`.toLowerCase().includes(batchSearch),
        ),
  );
  /*
   * The same query over the remembered half, and it reads the FILE NAMES as well as the matter:
   * somebody coming back for a file they sent last week remembers what the file was called, which
   * is the one fact the live half has no equivalent of.
   */
  const remembered = $derived(
    batchSearch === ""
      ? everyRemembered
      : everyRemembered.filter((entry) =>
          `${entry.matterTitle} ${entry.destinationLabel} ${entry.files
            .map((file) => file.name)
            .join(" ")}`
            .toLowerCase()
            .includes(batchSearch),
        ),
  );

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
  const finishedAt = (entry: UploadHistoryEntry): string => formatInstant(entry.finishedAt);

  /** Where a remembered batch landed, as the file list opens it. */
  function rememberedFolderHref(entry: UploadHistoryEntry): string {
    const base = `/matters/${encodeURIComponent(entry.matterId)}/files`;
    return entry.destinationFolderId === null
      ? base
      : `${base}?folder=${encodeURIComponent(entry.destinationFolderId)}`;
  }

  /*
   * How a remembered file ended, in the reader's words. "Landed" is left unsaid: a row that offers
   * a download has visibly succeeded, and a column that reads the same word down every line of a
   * mostly-successful batch is a column of noise.
   */
  const OUTCOME_WORDS: Record<UploadHistoryFile["outcome"], string> = {
    landed: "",
    failed: "Failed",
    skipped: "Skipped",
    "not-sent": "Not sent",
  };

  /** Which remembered batches are open. Closed by default: the register is a list of batches. */
  let openEntries = $state<Record<string, boolean>>({});

  /** The columns the header row below draws, which is what an empty body spans. */
  const REMEMBERED_COLUMN_COUNT = 4;
</script>

<!-- One header row for the remembered files, drawn by the register whether or not it is holding
     anything: the empty register shows the shape a batch opens to, and a batch that is open shows
     the same one, so the two cannot drift apart. -->
{#snippet rememberedFileHead(caption: string)}
  <DataTable.Caption class="sr-only">{caption}</DataTable.Caption>
  <DataTable.Header>
    <DataTable.Row>
      <DataTable.Head>Name</DataTable.Head>
      <DataTable.Head>Size</DataTable.Head>
      <DataTable.Head>Standing</DataTable.Head>
      <DataTable.Head><span class="sr-only">Actions</span></DataTable.Head>
    </DataTable.Row>
  </DataTable.Header>
{/snippet}

<svelte:head>
  <title>Uploads · Magna Carta</title>
</svelte:head>

<ScreenHeader title="Uploads" class="mb-24">
  {#snippet actions()}
    <!-- The search leads the row and grows toward the inline start, so Clear Finished never moves
         when it opens — the same order as every other Workspace screen. -->
    <ScreenSearch
      bind:value={searchText}
      label="Search your uploads"
      fieldClass="w-2xs sm:w-xs"
      onsearch={(next) => {
        appliedSearch = next;
      }}
    />
    {#if finishedCount > 0}
      <Button variant="ghost" onclick={dismissFinishedUploads}>
        <Trash2 class="size-16" aria-hidden="true" />
        Clear Finished
      </Button>
    {/if}
    {#if everyRemembered.length > 0}
      <!-- Clears what this BROWSER remembers, and nothing else — the files stay on their matters.
           Its label says "history" for exactly that reason: "Clear Uploads" beside a list of files
           would read as a control that removes them. -->
      <Button variant="ghost" onclick={clearUploadHistory}>
        <Trash2 class="size-16" aria-hidden="true" />
        Clear History
      </Button>
    {/if}
  {/snippet}
</ScreenHeader>

{#if batches.length === 0 && remembered.length === 0}
  <!-- Nothing in the air and nothing remembered: the register still renders the shape files arrive
       in — the same header row a remembered batch opens to, over an empty body carrying the one
       line that says whether the register is empty or the query simply reaches none of it. -->
  <section class="flex flex-col gap-8" aria-label="Uploads">
    <DataTable.Root>
      {@render rememberedFileHead("The files this browser remembers uploading")}
      <DataTable.Body>
        <DataTable.EmptyRow
          columns={REMEMBERED_COLUMN_COUNT}
          title={batchSearch === "" ? NO_UPLOADS : "Nothing Matches That Search"}
        />
      </DataTable.Body>
    </DataTable.Root>
  </section>
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
            {#if batch.uploaded > 0}
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
    {#if remembered.length > 0}
      <!-- What this browser remembers. Its own heading rather than more rows above: these files
           are on their matters now, and the half above is bytes still in the air. -->
      <section class="flex flex-col gap-16" aria-label="Uploads this browser remembers">
        <FieldLabel as="h2">Earlier</FieldLabel>
        {#each remembered as entry (entry.id)}
          {@const isOpen = openEntries[entry.id] === true}
          <div class="flex flex-col gap-8">
            <div class="flex flex-wrap items-baseline gap-8">
              <!-- The batch's name opens its files. A disclosure rather than a table of every file
                   at once: a browser can remember fifty batches, and the question a reader arrives
                   with is which upload, then which file inside it. -->
              <Button
                variant="ghost"
                size="sm"
                aria-expanded={isOpen}
                onclick={() => (openEntries = { ...openEntries, [entry.id]: !isOpen })}
              >
                {entry.matterTitle}
              </Button>
              <span class="text-sm text-text-muted">{entry.destinationLabel}</span>
              <span class="text-xs text-text-subtle">finished {finishedAt(entry)}</span>
              <span class="ms-auto text-xs text-text-subtle" role="status">
                {String(entry.landed)} of {String(entry.total)} uploaded
              </span>
            </div>
            {#if isOpen}
              <DataTable.Root>
                {@render rememberedFileHead(`Files uploaded to ${entry.matterTitle}`)}
                <DataTable.Body>
                  {#each entry.files as file, index (`${String(index)}:${file.name}`)}
                    <DataTable.Row>
                      <DataTable.Cell>{file.name}</DataTable.Cell>
                      <DataTable.Cell>{formatBytes(file.byteSize)}</DataTable.Cell>
                      <DataTable.Cell>{OUTCOME_WORDS[file.outcome]}</DataTable.Cell>
                      <DataTable.Cell data-align="end">
                        {#if file.fileId !== null}
                          <!-- A real link to the file's own download route, which redirects to a
                               short-lived presigned URL the browser's own download manager drives
                               — the same route the matter's file list uses, so a file downloaded
                               from here is the file on the matter and not a copy of it. -->
                          <Button
                            variant="ghost"
                            size="sm"
                            href={fileDownloadUrl(file.fileId)}
                            download={file.name}
                            aria-label={`Download ${file.name}`}
                          >
                            <Download class="size-16" aria-hidden="true" />
                            Download
                          </Button>
                        {/if}
                      </DataTable.Cell>
                    </DataTable.Row>
                  {:else}
                    <DataTable.EmptyRow
                      columns={REMEMBERED_COLUMN_COUNT}
                      title="No Files Remembered"
                    />
                  {/each}
                </DataTable.Body>
              </DataTable.Root>
              {#if entry.files.length < entry.total}
                <!-- A batch of thousands is remembered in part, and says so rather than reading as
                     a batch that was smaller than it was. -->
                <p class="text-xs text-text-muted">
                  The first {String(entry.files.length)} of {String(entry.total)} files are
                  remembered here; the rest are on the matter.
                </p>
              {/if}
            {/if}
            <div class="flex flex-wrap items-center gap-8">
              <Button variant="secondary" size="sm" href={rememberedFolderHref(entry)}>
                <FolderOpen class="size-16" aria-hidden="true" />
                Open Folder
              </Button>
              <Button variant="ghost" size="sm" onclick={() => forgetUpload(entry.id)}>
                Clear
              </Button>
            </div>
          </div>
        {/each}
      </section>
    {/if}
  </div>
{/if}
