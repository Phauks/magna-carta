<script lang="ts">
  /*
   * Downloads — the member's own register of everything they have downloaded.
   *
   * IT USED TO BE A SHELF OF WHAT THE PLATFORM MADE, and only exports ever reached it; a file taken
   * from a matter, a bundle, a converted file and a discovery production were all absent, so "I
   * downloaded something and it did not appear here" was the correct behaviour. Every producer
   * registers now (apps/api-worker/src/downloads/download-register.ts, held by
   * `pnpm run lint:download-register`), and the row outlives the bytes — so this screen answers two
   * questions rather than one: what did I take, and which of it can I still have.
   *
   * THAT IS WHY IT IS THE GRID. A fixed list of columns served a register that held one kind of
   * thing. It holds five now, which answer different questions — somebody hunting Tuesday's
   * spreadsheet wants the name and the day, somebody asking what they pulled off a matter before a
   * hearing wants the type and its standing — so the columns are declared (download-columns.ts) and
   * the reader chooses, sorts, filters and keeps a layout, like every other register in the product.
   *
   * WHAT "DOWNLOAD AGAIN" DOES DEPENDS ON THE KIND, and the difference is not cosmetic. An export is
   * stored as its DOCUMENT, so one row offers every format and the figures stay frozen at the instant
   * it was taken. An artifact hands back a short-lived signed URL. A matter file hands back this
   * platform's own address for it, so the matter's access check runs again — which is what stops a
   * register row becoming a standing grant over a matter somebody has since been screened off.
   */
  import { openBeside } from "$lib/navigation/open-beside.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { guidanceFor } from "$lib/diagnostics/guidance.ts";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Download from "@lucide/svelte/icons/download";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import { toast } from "@magna-carta/design-system/toast";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import {
    exportFromStored,
    fetchShelfItem,
    readShelf,
    removeShelfItem,
    type ShelfItem,
    type StoredExportDocument,
  } from "$lib/export/download-shelf.ts";
  import { markShelfChanged } from "$lib/export/download-shelf-signal.svelte.ts";
  import {
    bulkArchiveFilename,
    bulkDownload,
    BULK_CONTENT_TYPES,
    renderStoredExport,
  } from "$lib/export/bulk-download.ts";
  import { exportFilename, saveExport } from "$lib/export/tabular-export.ts";
  import {
    downloadRegisterColumns,
    DOWNLOAD_COLUMN_IDENTIFIERS,
    DOWNLOAD_REGISTER_INITIAL_SORT,
    isTakeable,
  } from "$lib/export/download-columns.ts";

  const list = new PagedList<ShelfItem>("Your downloads could not be read.");
  const items = $derived(list.items);
  let gathering = $state(false);
  /*
   * What is being searched, and what the field currently holds. They are two values because the
   * field runs ahead of the read: the register is narrowed on the SERVER — it has no bound, so
   * narrowing the rows already loaded would answer confidently about a fraction of it — and a
   * request per keystroke would ask a question the reader has already moved past.
   */
  let searchText = $state("");
  let appliedSearch = $state("");
  /*
   * A download that failed, by item: stated on its own row with the way to try again beside it,
   * rather than in a toast — a toast vanishes, and the reader who watched it go has nothing left to
   * press.
   */
  let failedTakes = $state<Record<string, { format: string; message: string }>>({});

  const grid = DataTable.createDataTableGrid<ShelfItem>({
    columns: () => downloadRegisterColumns(),
    rows: () => items ?? [],
    rowKey: (item) => item.id,
    initialSort: DOWNLOAD_REGISTER_INITIAL_SORT,
    itemNoun: { singular: "download", plural: "downloads" },
  });

  /* The register keeps every download and keeps the row after the bytes go, so it grows for as long
     as somebody works here and arrives a page at a time. */
  const read = (cursor?: string) => readShelf(fetch, { cursor, search: appliedSearch });

  // What the rows on screen are an answer to. A change of it is a different question, so the rows
  // are discarded and read again; a re-read of the SAME question is a refresh.
  const subject = $derived(`downloads|${appliedSearch}`);

  function reread(): void {
    list.reset(subject);
    void list.load(read);
  }

  $effect(() => {
    if (list.showing(subject)) return;
    reread();
  });

  function recordFailedTake(id: string, format: string, message: string): void {
    failedTakes = { ...failedTakes, [id]: { format, message } };
  }

  function clearFailedTake(id: string): void {
    failedTakes = Object.fromEntries(Object.entries(failedTakes).filter(([key]) => key !== id));
  }

  // The formats a stored export can be taken as. The same set the export menu offers, because the
  // stored document is the same document — a register that offered fewer would make keeping a copy
  // worse than taking it again.
  const SNAPSHOT_FORMATS = [
    { label: "Excel, Sheet per Table (.xlsx)", extension: "xlsx" },
    { label: "Excel, Single Sheet (.xlsx)", extension: "xlsx-single" },
    { label: "Word (.docx)", extension: "docx" },
    { label: "PDF (.pdf)", extension: "pdf" },
    { label: "CSV (.csv)", extension: "csv" },
    { label: "Plain Text (.txt)", extension: "txt" },
  ] as const;

  async function renderStored(stored: StoredExportDocument, extension: string): Promise<void> {
    const exportDocument = exportFromStored(stored);
    saveExport(
      await renderStoredExport(exportDocument, extension),
      exportFilename(exportDocument, extension === "xlsx-single" ? "xlsx" : extension),
      BULK_CONTENT_TYPES[extension] ?? "application/octet-stream",
    );
  }

  async function take(item: ShelfItem, format: string): Promise<void> {
    const outcome = await fetchShelfItem(fetch, item.id, format);
    if (outcome.kind !== "ok") {
      recordFailedTake(item.id, format, guidanceFor(outcome.failure, "That download").message);
      // A gone item is gone for good, so the register is re-read rather than left showing it ready.
      if (outcome.kind === "problem" && outcome.problem.status === 410) reread();
      return;
    }
    try {
      if (outcome.value.kind === "snapshot") {
        await renderStored(outcome.value.document as StoredExportDocument, format);
      } else {
        // An artifact's signed URL, or — for a matter file — this platform's own address for it,
        // which re-runs the matter's access check. Either way a real link the browser's own
        // download manager drives, never bytes proxied through here.
        const url = outcome.value.url;
        if (url === undefined) throw new Error("no url");
        globalThis.location.href = url;
      }
      clearFailedTake(item.id);
      reread();
    } catch {
      recordFailedTake(item.id, format, "That download could not be produced. Try again shortly.");
    }
  }

  /*
   * Take everything selected in one act. Snapshots render and travel in a single archive; anything
   * whose bytes reach the member over a URL cannot join it, so each is opened on its own after. A
   * partial result is always reported as partial.
   */
  async function takeSelected(): Promise<void> {
    const selected = grid.selectedRows;
    if (selected.length === 0 || gathering) return;
    gathering = true;
    try {
      const result = await bulkDownload(fetch, selected);
      if (result.archive !== null) {
        saveExport(result.archive, bulkArchiveFilename(new Date()), "application/zip");
      }
      const unreachable: ShelfItem[] = [];
      for (const item of result.linked) {
        const outcome = await fetchShelfItem(fetch, item.id, "file");
        if (outcome.kind === "ok" && outcome.value.url !== undefined) {
          openBeside(outcome.value.url, "file");
        } else {
          unreachable.push(item);
        }
      }
      const short = result.failed.length + unreachable.length;
      if (short > 0) {
        toast.error(
          `${String(short)} of ${String(selected.length)} could not be produced. The rest downloaded.`,
        );
      }
      grid.clearSelection();
      reread();
      markShelfChanged();
    } finally {
      gathering = false;
    }
  }

  async function remove(item: ShelfItem): Promise<void> {
    const outcome = await removeShelfItem(fetch, item.id);
    if (outcome.kind === "ok") {
      list.items = (list.items ?? []).filter((row) => row.id !== item.id);
      // Keep the top-bar tray in step with the page; both read the same register.
      markShelfChanged();
      return;
    }
    toast.error("That item could not be removed.");
  }

  const selectedCount = $derived(grid.selectedRows.length);
</script>

<svelte:head>
  <title>Downloads · Magna Carta</title>
</svelte:head>

{#snippet cell({ row, column, text }: DataTable.GridCellContext<ShelfItem>)}
  {#if column.id === DOWNLOAD_COLUMN_IDENTIFIERS.title}
    <span class="block truncate" title={row.title}>{row.title}</span>
  {:else if column.id === DOWNLOAD_COLUMN_IDENTIFIERS.actions}
    <span class="inline-flex items-center justify-end gap-4">
      {#if failedTakes[row.id] !== undefined}
        <span class="text-status-danger-subtle-foreground text-xs" title={failedTakes[row.id]?.message}>
          Download failed
        </span>
        <Button
          variant="ghost"
          size="sm"
          onclick={() => void take(row, failedTakes[row.id]?.format ?? "file")}
          aria-label={`Try downloading ${row.title} again`}
        >
          <RotateCcw class="size-16" aria-hidden="true" />
          Retry
        </Button>
      {:else if row.kind === "snapshot"}
        <!-- An export is a document, so the format is chosen at the moment of taking it. -->
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class={buttonClasses({ variant: "ghost", size: "sm" })}
            aria-label={`Download ${row.title} again`}
          >
            <Download class="size-16" aria-hidden="true" />
            Download
            <ChevronDown class="size-16" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            {#each SNAPSHOT_FORMATS as format (format.label)}
              <DropdownMenu.Item onSelect={() => void take(row, format.extension)}>
                {format.label}
              </DropdownMenu.Item>
            {/each}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {:else if isTakeable(row)}
        <Button
          variant="ghost"
          size="sm"
          onclick={() => void take(row, "file")}
          aria-label={`Download ${row.title} again`}
        >
          <Download class="size-16" aria-hidden="true" />
          Download
        </Button>
      {/if}
      <!-- Removing takes the row off this member's own register. It never reaches a matter's file:
           a reference names something that was never the register's to delete. -->
      <Button
        variant="ghost"
        size="sm"
        onclick={() => void remove(row)}
        aria-label={`Remove ${row.title}`}
      >
        <Trash2 class="size-16" aria-hidden="true" />
        Remove
      </Button>
    </span>
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col">
  <ScreenHeader title="Downloads" class="mb-24">
    {#snippet actions()}
      {#if selectedCount > 0}
        <Button onclick={() => void takeSelected()} disabled={gathering}>
          <Download class="size-16" aria-hidden="true" />
          {gathering ? "Gathering" : `Download ${String(selectedCount)} Selected`}
        </Button>
      {/if}
      <Button variant="ghost" onclick={reread}>
        <RotateCcw class="size-16" aria-hidden="true" />
        Refresh
      </Button>
      <ScreenSearch
        bind:value={searchText}
        label="Search your downloads"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />
      <DataTable.ClearFilters {grid} />
    {/snippet}
  </ScreenHeader>

  {#if list.failure !== null && items === null}
    <FailureNotice
      failure={list.failure}
      title="Your Downloads Could Not Be Read"
      fallback={list.failureMessage ?? undefined}
      onRetry={reread}
    />
  {:else}
    <!-- The grid stands whether or not anything has been downloaded: its header row is the shape a
         member's downloads will take, and its own empty body says "No Results" — one wording for an
         empty register and for a term that matched nothing, since the grid offers the way back
         either way. A sentence on the canvas where the table will be is the shape the
         table-behind-absence rule refuses. -->
    <DataTable.Grid
      {grid}
      {cell}
      class="min-h-0 flex-1"
      caption="Everything you have downloaded"
      loading={items === null}
    ></DataTable.Grid>

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="downloads"
          more={list.nextCursor !== null}
          loading={list.loadingMore}
          onLoad={() => void list.loadMore(read)}
        />
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</div>
