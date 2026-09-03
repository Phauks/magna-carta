<script lang="ts">
  /*
   * The top-bar download tray — the ambient way back to what the platform just made you.
   *
   * The shelf itself is the /downloads destination; this is its entry in the actions cluster, on
   * the owner's direction that a download should be visible from the top of the app rather than
   * only from the sidebar. It lists the most recent items and offers the full page.
   *
   * It is NOT a transfer manager and must not become one: bytes move over a presigned URL that the
   * browser's own download manager drives (docs/conventions/network-resilience.md), so there is no
   * progress here to show and no transfer for this component to own.
   *
   * The dot is honest state, not decoration: it means the shelf holds something that arrived since
   * this browser last opened the tray. That is a per-browser convenience, so it lives in
   * localStorage rather than on the member's record.
   */
  import { onMount } from "svelte";
  import { guidanceFor } from "$lib/diagnostics/guidance.ts";
  import Download from "@lucide/svelte/icons/download";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import Button from "@magna-carta/design-system/button";
  import * as Popover from "@magna-carta/design-system/popover";
  import { MaturityDot } from "@magna-carta/design-system/maturity";
  import {
    DESTINATIONS,
    destinationStage,
    type Destination,
  } from "$lib/navigation/destinations.ts";
  import {
    exportFromStored,
    fetchShelfItem,
    readShelf,
    type ShelfItem,
    type StoredExportDocument,
  } from "./download-shelf.ts";
  import { markShelfChanged, shelfRevision } from "./download-shelf-signal.svelte.ts";
  import { renderCsvExport } from "./render-csv.ts";
  import { renderRemoteExport } from "./render-remote.ts";
  import { renderTextExport } from "./render-text.ts";
  import { renderXlsxExport } from "./render-xlsx.ts";
  import { exportFilename, saveExport } from "./tabular-export.ts";

  // How many the tray shows. The tray is a glance, not the register — the page below it is where a
  // member reads the whole shelf.
  const TRAY_LIMIT = 4;
  const LAST_SEEN_KEY = "mc-download-tray-last-seen";

  // This is the top-bar entry to the Downloads destination, so its maturity dot reads the same
  // stage as that destination's sidebar row — the bell's arrangement, for the same reason.
  const downloadsDestination = DESTINATIONS.find(
    (destination) => destination.id === "downloads",
  ) as Destination;

  let open = $state(false);
  let items = $state<ShelfItem[]>([]);
  let lastSeen = $state<string>("");
  // A download that failed, by item: stated under its row with the way to try again beside it. A
  // toast has nowhere to put a retry, and vanishes before the reader has decided to.
  let failedTakes = $state<Record<string, string>>({});

  function readLastSeen(): string {
    try {
      return globalThis.localStorage?.getItem(LAST_SEEN_KEY) ?? "";
    } catch {
      // A private window, or a browser refusing site data. The tray still works; it just cannot
      // remember what this browser has already seen, so nothing is marked new.
      return "";
    }
  }

  function writeLastSeen(value: string): void {
    try {
      globalThis.localStorage?.setItem(LAST_SEEN_KEY, value);
    } catch {
      // Same as above: the convenience is unavailable, the tray is not.
    }
  }

  async function load(): Promise<void> {
    const outcome = await readShelf(fetch);
    // A failure here is silent on purpose: the tray is chrome on every screen in the app, and a
    // member working on a matter must not be handed an error about a surface they did not open.
    // The /downloads page states the failure properly when they go looking.
    if (outcome.kind === "ok") items = [...outcome.value.items];
  }

  onMount(() => {
    lastSeen = readLastSeen();
    void load();
  });

  // Re-read whenever an export lands on the shelf, so the tray is current the moment a download
  // finishes rather than at the next page load.
  $effect(() => {
    shelfRevision();
    void load();
  });

  const newest = $derived(items[0]?.createdAt ?? "");
  // ISO-8601 UTC instants compare lexicographically, which is what the whole platform relies on.
  const hasUnseen = $derived(newest !== "" && newest > lastSeen);

  $effect(() => {
    if (open && newest !== "") {
      lastSeen = newest;
      writeLastSeen(newest);
    }
  });

  const CONTENT_TYPES: Record<string, string> = {
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pdf: "application/pdf",
    csv: "text/csv;charset=utf-8",
    txt: "text/plain;charset=utf-8",
  };

  /*
   * The tray takes an item in the format it was last taken as — the member is reaching for the file
   * they already had, and asking them to pick a format again at this size of surface would be a
   * menu inside a menu. The full page is where a different format is chosen.
   */
  async function take(item: ShelfItem): Promise<void> {
    const format = item.downloadedFormats[0] ?? "xlsx";
    const outcome = await fetchShelfItem(fetch, item.id, format);
    if (outcome.kind !== "ok") {
      // The presenter's sentence rather than the whole record — the wording rules still apply, the
      // furniture does not fit in a tray.
      failedTakes = {
        ...failedTakes,
        [item.id]: guidanceFor(outcome.failure, "That download").message,
      };
      markShelfChanged();
      return;
    }
    try {
      if (outcome.value.kind === "artifact") {
        const url = outcome.value.url;
        if (url === undefined) throw new Error("no url");
        globalThis.location.href = url;
      } else {
        const exportDocument = exportFromStored(outcome.value.document as StoredExportDocument);
        const rendered =
          format === "csv"
            ? renderCsvExport(exportDocument)
            : format === "txt"
              ? renderTextExport(exportDocument)
              : format === "docx" || format === "pdf"
                ? await renderRemoteExport(exportDocument, format)
                : await renderXlsxExport(exportDocument, "worksheet-per-section");
        saveExport(
          rendered,
          exportFilename(exportDocument, format === "xlsx-single" ? "xlsx" : format),
          CONTENT_TYPES[format] ?? "application/octet-stream",
        );
      }
      failedTakes = Object.fromEntries(
        Object.entries(failedTakes).filter(([key]) => key !== item.id),
      );
      open = false;
    } catch {
      failedTakes = {
        ...failedTakes,
        [item.id]: "That download could not be produced. Try again shortly.",
      };
    }
  }

  function stamp(value: string): string {
    return new Date(value).toLocaleTimeString(undefined, { timeStyle: "short" });
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger class="mc-top-bar-icon-button relative" aria-label="Downloads">
    <Download class="size-16" aria-hidden="true" />
    {#if hasUnseen}
      <!-- Real state: the shelf holds something that arrived since this browser last looked. One
           16px corner holds one mark, so while there is something new the arrival dot takes the
           slot from the maturity dot — the more time-sensitive signal wins it, and the stage stays
           stated on the sidebar row and in the panel below. -->
      <span
        class="absolute end-4 top-4 block size-8 rounded-full"
        style="background: var(--mc-accent-default)"
        aria-hidden="true"
      ></span>
      <span class="sr-only">New downloads</span>
    {:else}
      <MaturityDot stage={destinationStage(downloadsDestination)} class="absolute end-4 top-4" />
    {/if}
  </Popover.Trigger>
  <Popover.Content
    align="end"
    class="flex flex-col gap-8"
    style="inline-size: var(--mc-size-popover)"
  >
    <p class="text-sm font-medium">Downloads</p>
    {#if items.length === 0}
      <p class="text-sm text-text-muted">Nothing here yet.</p>
      <p class="text-xs text-text-muted">
        Reports and files the platform makes for you gather here for a week.
      </p>
    {:else}
      <ul class="flex flex-col gap-4">
        {#each items.slice(0, TRAY_LIMIT) as item (item.id)}
          <li>
            <button
              type="button"
              class="flex w-full flex-col items-start gap-2 rounded-4 p-8 text-start hover:bg-surface-sunken"
              onclick={() => void take(item)}
            >
              <span class="text-sm font-medium">{item.title}</span>
              <span class="text-xs text-text-muted">
                {stamp(item.createdAt)} · {item.downloadedFormats.length === 0
                  ? "Not yet taken"
                  : item.downloadedFormats.map((entry) => entry.toUpperCase()).join(", ")}
              </span>
            </button>
            {#if failedTakes[item.id] !== undefined}
              <div class="flex items-center gap-8 px-8 pb-4">
                <span
                  class="text-xs text-status-danger-subtle-foreground"
                  role="status"
                  title={failedTakes[item.id]}
                >
                  Download failed
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onclick={() => void take(item)}
                  aria-label={`Retry downloading ${item.title}`}
                >
                  <RotateCcw class="size-16" aria-hidden="true" />
                  Retry
                </Button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    <a
      href="/downloads"
      class="text-sm font-medium"
      style="color: var(--mc-accent-default)"
      onclick={() => (open = false)}
    >
      Open downloads
    </a>
  </Popover.Content>
</Popover.Root>
