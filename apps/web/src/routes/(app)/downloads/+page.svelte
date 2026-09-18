<script lang="ts">
  /*
   * Downloads — the member's own shelf of what the platform produced for them, held for a short
   * window and downloadable again until it expires. It is deliberately not the notification feed:
   * that surface carries the firm's WORK, and a generated file is platform mechanics.
   *
   * An export is stored as its DOCUMENT rather than as a file, so one row offers every format and
   * the figures stay frozen at the instant it was taken. The register never proxies bytes — an
   * artifact hands back a short-lived URL the browser downloads directly.
   *
   * THE TABLE STANDS WHETHER OR NOT THE SHELF DOES. The header row renders from the first paint and
   * the empty body carries the one line saying why it is empty — a shelf with nothing on it, or a
   * query that reaches none of it. A member who has never exported anything meets the shape their
   * files will arrive in rather than a sentence on the canvas where the table will be.
   */
  import { onMount } from "svelte";
  import { openBeside } from "$lib/navigation/open-beside.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { guidanceFor } from "$lib/diagnostics/guidance.ts";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Download from "@lucide/svelte/icons/download";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleDate, sampleMatter } from "@magna-carta/design-system/loading-fixtures";
  import { toast } from "@magna-carta/design-system/toast";
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
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { NO_DOWNLOADS } from "$lib/transfers/transfers.ts";

  let items = $state<ShelfItem[] | null>(null);
  let failure = $state<StatedFailure | null>(null);
  // True while the shelf is being read. With rows already on screen — Refresh, or the re-read
  // after a download — they stay where the reader is looking until the fresh ones land.
  let reading = $state(false);
  // Selection is the reason exporting generates rather than downloads: several items gathered over a
  // morning are taken in one act. Held as ids so a refresh that drops a row drops it from the
  // selection too, rather than leaving a phantom selected item nothing can act on.
  let selectedIds = $state<string[]>([]);
  let gathering = $state(false);
  // A download that failed, by shelf item: stated on its own row with the way to try again beside
  // it, rather than in a toast — a toast vanishes, and the reader who watched it go has nothing
  // left to press.
  let failedTakes = $state<Record<string, { format: string; message: string }>>({});

  function recordFailedTake(id: string, format: string, message: string): void {
    failedTakes = { ...failedTakes, [id]: { format, message } };
  }

  function clearFailedTake(id: string): void {
    failedTakes = Object.fromEntries(Object.entries(failedTakes).filter(([key]) => key !== id));
  }

  const selectedItems = $derived((items ?? []).filter((item) => selectedIds.includes(item.id)));

  /*
   * Narrowing the shelf. The whole shelf is already in the browser — it is one member's week of
   * generated files, not a paged register — so the query runs on every keystroke and never leaves
   * the machine. It reads the title and what produced the row, which is what a person remembers
   * about a file they asked for on Tuesday.
   */
  let searchText = $state("");
  let appliedSearch = $state("");
  const shelfSearch = $derived(appliedSearch.trim().toLowerCase());
  /*
   * What the shelf's empty body says. The table stands whether or not there is anything on the
   * shelf, so this line is the only thing that changes: an empty shelf, and a shelf the query
   * reaches none of, are different facts and the reader needs to know which one they are looking at.
   */
  const shelfEmptyTitle = $derived(
    shelfSearch === "" ? NO_DOWNLOADS : "Nothing Matches That Search",
  );
  const narrowedItems = $derived(
    items === null
      ? null
      : shelfSearch === ""
        ? items
        : items.filter((item) =>
            `${item.title} ${item.producer} ${item.requestedFormat ?? ""}`
              .toLowerCase()
              .includes(shelfSearch),
          ),
  );

  function toggleSelected(id: string): void {
    selectedIds = selectedIds.includes(id)
      ? selectedIds.filter((entry) => entry !== id)
      : [...selectedIds, id];
  }

  // The formats a stored export can be taken as. The same set the export menu offers, because the
  // stored document is the same document — a shelf that offered fewer would make keeping a copy
  // worse than taking it again.
  const SNAPSHOT_FORMATS = [
    { label: "Excel, Sheet per Table (.xlsx)", extension: "xlsx" },
    { label: "Excel, Single Sheet (.xlsx)", extension: "xlsx-single" },
    { label: "Word (.docx)", extension: "docx" },
    { label: "PDF (.pdf)", extension: "pdf" },
    { label: "CSV (.csv)", extension: "csv" },
    { label: "Plain Text (.txt)", extension: "txt" },
  ] as const;

  async function load(): Promise<void> {
    failure = null;
    reading = true;
    const outcome = await readShelf(fetch);
    reading = false;
    if (outcome.kind === "ok") {
      items = [...outcome.value.items];
      const present = new Set(items.map((item) => item.id));
      selectedIds = selectedIds.filter((id) => present.has(id));
    } else {
      items = null;
      failure = stated(outcome.failure, "Your downloads could not be read.");
    }
  }

  onMount(() => {
    void load();
  });

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
      // A gone item is gone for good, so the shelf is re-read rather than left showing it.
      if (outcome.kind === "problem" && outcome.problem.status === 410) void load();
      return;
    }
    try {
      if (outcome.value.kind === "artifact") {
        const url = outcome.value.url;
        if (url === undefined) throw new Error("no url");
        // A real link the browser's own download manager drives, never bytes proxied through here.
        globalThis.location.href = url;
      } else {
        await renderStored(outcome.value.document as StoredExportDocument, format);
      }
      clearFailedTake(item.id);
      void load();
    } catch {
      recordFailedTake(item.id, format, "That download could not be produced. Try again shortly.");
    }
  }

  /*
   * Take everything selected in one act. Snapshots render and travel in a single archive; artifacts
   * cannot join it — their bytes reach the member over a presigned URL the browser downloads
   * directly — so each is opened on its own after. A partial result is always reported as partial.
   */
  async function takeSelected(): Promise<void> {
    if (selectedItems.length === 0 || gathering) return;
    gathering = true;
    try {
      const result = await bulkDownload(fetch, selectedItems);
      if (result.archive !== null) {
        saveExport(result.archive, bulkArchiveFilename(new Date()), "application/zip");
      }
      const unreachable: ShelfItem[] = [];
      for (const artifact of result.artifacts) {
        const outcome = await fetchShelfItem(fetch, artifact.id, "file");
        if (outcome.kind === "ok" && outcome.value.url !== undefined) {
          openBeside(outcome.value.url, "file");
        } else {
          unreachable.push(artifact);
        }
      }
      const short = result.failed.length + unreachable.length;
      if (short > 0) {
        toast.error(
          `${String(short)} of ${String(selectedItems.length)} could not be produced. The rest downloaded.`,
        );
      }
      selectedIds = [];
      void load();
      markShelfChanged();
    } finally {
      gathering = false;
    }
  }

  async function remove(item: ShelfItem): Promise<void> {
    const outcome = await removeShelfItem(fetch, item.id);
    if (outcome.kind === "ok") {
      items = (items ?? []).filter((row) => row.id !== item.id);
      // Keep the top-bar tray in step with the page; both read the same shelf.
      markShelfChanged();
      return;
    }
    toast.error("That item could not be removed.");
  }

  const PRODUCER_LABELS: Record<string, string> = {
    export: "Export",
    bundle: "File Bundle",
    conversion: "Converted File",
  };

  const formatStamp = (value: string): string => formatInstant(value);

  function formatTaken(formats: readonly string[]): string {
    if (formats.length === 0) return "Not yet";
    return formats.map((entry) => entry.toUpperCase()).join(", ");
  }

  /*
   * The shape the shelf takes while it is read: the same table, over invented items from the
   * sample vocabulary. Inert and hidden from assistive technology while it stands, so no row in it
   * reads as something the platform made for this member.
   */
  const SHELF_FIXTURE = [
    {
      id: "fixture-1",
      title: `Matters docket, ${sampleDate(0)}`,
      source: PRODUCER_LABELS.export ?? "Export",
      format: "XLSX",
      taken: "XLSX, PDF",
      created: sampleDate(0),
      until: sampleDate(3),
    },
    {
      id: "fixture-2",
      title: `Trust ledger, ${sampleMatter(0).title}`,
      source: PRODUCER_LABELS.export ?? "Export",
      format: "PDF",
      taken: "Not yet",
      created: sampleDate(1),
      until: sampleDate(4),
    },
    {
      id: "fixture-3",
      title: `${sampleMatter(1).title}, discovery bundle`,
      source: PRODUCER_LABELS.bundle ?? "File Bundle",
      format: "ZIP",
      taken: "ZIP",
      created: sampleDate(2),
      until: sampleDate(1),
    },
  ] as const;

  /** The columns the header row draws, which is what the empty body spans. */
  const SHELF_COLUMN_COUNT = 8;
</script>

{#snippet shelfHead()}
  <!-- The header row renders from the first paint, whether or not the shelf has anything on it:
       a reader meets the shape the rows will take rather than a sentence where the table will be.
       The count below spans the empty body across exactly these columns. -->
  <DataTable.Caption class="sr-only">Your downloads</DataTable.Caption>
  <DataTable.Header>
    <DataTable.Row>
      <DataTable.Head><span class="sr-only">Select</span></DataTable.Head>
      <DataTable.Head>Name</DataTable.Head>
      <DataTable.Head>Source</DataTable.Head>
      <DataTable.Head>Format</DataTable.Head>
      <DataTable.Head>Downloaded</DataTable.Head>
      <DataTable.Head>Created</DataTable.Head>
      <DataTable.Head>Available Until</DataTable.Head>
      <DataTable.Head><span class="sr-only">Actions</span></DataTable.Head>
    </DataTable.Row>
  </DataTable.Header>
{/snippet}

<svelte:head>
  <title>Downloads · Magna Carta</title>
</svelte:head>

<ScreenHeader
  title="Downloads"
  class="mb-24"
>
  {#snippet actions()}
    <!-- The search leads the row and grows toward the inline start, so Refresh never moves when it
         opens — the same order as every other Workspace screen. -->
    <ScreenSearch
      bind:value={searchText}
      label="Search your downloads"
      fieldClass="w-2xs sm:w-xs"
      onsearch={(next) => {
        appliedSearch = next;
      }}
    />
    <Button variant="ghost" onclick={() => void load()}>
      <RotateCcw class="size-16" aria-hidden="true" />
      Refresh
    </Button>
  {/snippet}
</ScreenHeader>

<!-- The page's own state is named `failure`, so the notice the region shows on a failed
     read takes a name of its own and is handed to the region's `failure` prop. -->
{#snippet failureNotice()}
  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      title="Your Downloads Could Not Be Read"
      fallback={failure.fallback}
      onRetry={() => void load()}
    />
  {/if}
{/snippet}

<LoadingRegion
  loading={items === null}
  refreshing={reading}
  failed={failure !== null}
  failure={failureNotice}
  label="Reading your downloads"
  onRetry={() => void load()}
>
  {#snippet fixture()}
    <DataTable.Root>
      {@render shelfHead()}
      <DataTable.Body>
        {#each SHELF_FIXTURE as item (item.id)}
          <DataTable.Row>
            <DataTable.Cell>
              <Checkbox checked={false} aria-label={`Select ${item.title}`} />
            </DataTable.Cell>
            <DataTable.Cell>{item.title}</DataTable.Cell>
            <DataTable.Cell>{item.source}</DataTable.Cell>
            <DataTable.Cell>{item.format}</DataTable.Cell>
            <DataTable.Cell>{item.taken}</DataTable.Cell>
            <DataTable.Cell>{item.created}</DataTable.Cell>
            <DataTable.Cell>{item.until}</DataTable.Cell>
            <DataTable.Cell data-align="end">
              <div class="flex items-center justify-end gap-8">
                <Button variant="ghost" size="sm">
                  <Download class="size-16" aria-hidden="true" />
                  Download
                </Button>
                <Button variant="ghost" size="sm">
                  <Trash2 class="size-16" aria-hidden="true" />
                  Remove
                </Button>
              </div>
            </DataTable.Cell>
          </DataTable.Row>
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  {/snippet}
  {@const shown = narrowedItems ?? []}
  {#if selectedItems.length > 0}
    <!-- Present only while a selection is in play: its absence is itself the answer to whether
         anything is selected. -->
    <div class="mb-16 flex items-center gap-8">
      <Button onclick={() => void takeSelected()} disabled={gathering}>
        <Download class="size-16" aria-hidden="true" />
        {gathering ? "Gathering" : `Download ${String(selectedItems.length)} Selected`}
      </Button>
      <Button variant="ghost" onclick={() => (selectedIds = [])} disabled={gathering}>
        Clear selection
      </Button>
    </div>
  {/if}
  <DataTable.Root>
    {@render shelfHead()}
    <DataTable.Body>
      {#each shown as item (item.id)}
        <DataTable.Row>
          <DataTable.Cell>
            <Checkbox
              checked={selectedIds.includes(item.id)}
              onCheckedChange={() => toggleSelected(item.id)}
              aria-label={`Select ${item.title}`}
            />
          </DataTable.Cell>
          <DataTable.Cell>{item.title}</DataTable.Cell>
          <DataTable.Cell>{PRODUCER_LABELS[item.producer] ?? item.producer}</DataTable.Cell>
          <DataTable.Cell>
            {item.requestedFormat === null ? "" : item.requestedFormat.toUpperCase()}
          </DataTable.Cell>
          <DataTable.Cell>{formatTaken(item.downloadedFormats)}</DataTable.Cell>
          <DataTable.Cell>{formatStamp(item.createdAt)}</DataTable.Cell>
          <DataTable.Cell>{formatStamp(item.expiresAt)}</DataTable.Cell>
          <DataTable.Cell data-align="end">
            <div class="flex items-center justify-end gap-8">
              {#if failedTakes[item.id] !== undefined}
                <span
                  class="text-xs text-status-danger-subtle-foreground"
                  role="status"
                  title={failedTakes[item.id]?.message}
                >
                  Download failed
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onclick={() => void take(item, failedTakes[item.id]?.format ?? "file")}
                  aria-label={`Retry downloading ${item.title}`}
                >
                  <RotateCcw class="size-16" aria-hidden="true" />
                  Retry
                </Button>
              {/if}
              {#if item.kind === "snapshot"}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger
                    class={buttonClasses({ variant: "ghost", size: "sm" })}
                    aria-label={`Download ${item.title} again`}
                  >
                    <Download class="size-16" aria-hidden="true" />
                    Download
                    <ChevronDown class="size-16" aria-hidden="true" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content
                    align="end"
                    style="inline-size: var(--mc-size-popover)"
                  >
                    {#each SNAPSHOT_FORMATS as format (format.label)}
                      <DropdownMenu.Item onSelect={() => void take(item, format.extension)}>
                        {format.label}
                      </DropdownMenu.Item>
                    {/each}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              {:else}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => void take(item, "file")}
                  aria-label={`Download ${item.title} again`}
                >
                  <Download class="size-16" aria-hidden="true" />
                  Download
                </Button>
              {/if}
              <Button
                variant="ghost"
                size="sm"
                onclick={() => void remove(item)}
                aria-label={`Remove ${item.title}`}
              >
                <Trash2 class="size-16" aria-hidden="true" />
                Remove
              </Button>
            </div>
          </DataTable.Cell>
        </DataTable.Row>
      {:else}
        <DataTable.EmptyRow columns={SHELF_COLUMN_COUNT} title={shelfEmptyTitle} />
      {/each}
    </DataTable.Body>
  </DataTable.Root>
</LoadingRegion>
