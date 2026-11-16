<script lang="ts">
  /*
   * The PDF Editor's Redact tab: mark regions on the pages, give each a reason, and apply them all
   * at once to make a redacted copy filed beside the original.
   *
   * NOTHING IS REMOVED UNTIL APPLY. A mark is a note about where to redact. Applying hands the
   * marks to the firm's own engine in a worker, which removes what lies under each box (or turns
   * the page into a picture where it cannot prove the text is gone) and verifies the result before
   * it hands a document back. The original version is never touched: the redacted document is a
   * new file in the same folder, so whoever was relying on the original still has it.
   *
   * One page is shown at a time, large enough to draw on, with the pages listed down the side.
   * Drawing is a press-drag-release on the page; a press that barely moves is ignored as a click.
   */
  import { onMount } from "svelte";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import FileX from "@lucide/svelte/icons/file-x";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Label from "@magna-carta/design-system/label";
  import * as Select from "@magna-carta/design-system/select";
  import { viewerHref } from "$lib/documents/editable-documents.ts";
  import {
    PdfDocumentSource,
    pageDisplaySize,
    renderDpiFor,
    type PdfPageSize,
  } from "$lib/documents/pdf-pages.ts";
  import { uploadIntoFolder } from "$lib/file-manager/file-upload.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { fileMadeDocument, openEditorDocument } from "./editor-document.ts";
  import { describeOperationFailure, runPdfOperation } from "./pdf-operations.ts";
  import {
    REDACTION_REASONS,
    boxBetween,
    engineRegions,
    inReadingOrder,
    isDeliberateMark,
    pointsToScreen,
    redactedCopyName,
    redactionLog,
    redactionLogCsv,
    screenToPoints,
    wholePageRect,
    type MarkedRedaction,
    type RedactionReason,
    type ScreenRect,
  } from "./redactions.ts";

  let { file }: { file: MatterFile } = $props();

  const ZOOM_FACTORS: readonly number[] = [0.75, 1, 1.25, 1.5, 2];
  const THUMBNAIL_ZOOM = 0.15;

  type Phase =
    | { readonly kind: "opening" }
    | { readonly kind: "refused"; readonly message: string }
    | { readonly kind: "ready" };

  type Result =
    | { readonly kind: "idle" }
    | { readonly kind: "applying" }
    | { readonly kind: "saved"; readonly fileId: string; readonly name: string; readonly pages: number }
    | { readonly kind: "downloadOnly"; readonly url: string; readonly name: string; readonly why: string }
    | { readonly kind: "failed"; readonly message: string };

  let phase = $state<Phase>({ kind: "opening" });
  let pages = $state<readonly PdfPageSize[]>([]);
  let currentPage = $state(0);
  let zoomIndex = $state(1);
  let marks = $state<MarkedRedaction[]>([]);
  let selectedKey = $state<string | null>(null);
  let defaultReason = $state<RedactionReason>("Personal Identifier");
  let removeHiddenData = $state(true);
  let saveLog = $state(true);
  let result = $state<Result>({ kind: "idle" });
  let dragStart = $state<{ x: number; y: number } | null>(null);
  let dragBox = $state<ScreenRect | null>(null);

  let source: PdfDocumentSource | null = null;
  /** The original bytes, kept so an apply runs on the document as it was read. Never modified. */
  let original: ArrayBuffer | null = null;
  let pageCanvas = $state<HTMLCanvasElement | null>(null);
  let thumbnailCanvases = $state<(HTMLCanvasElement | null)[]>([]);
  /** The side list's pages already drawn. Drawn once each; the side list never changes size. */
  const paintedThumbnails = new Set<number>();
  let gone = false;
  let nextKey = 1;

  const zoom = $derived(ZOOM_FACTORS[zoomIndex] ?? 1);
  const pageSize = $derived(pages[currentPage] ?? null);
  const display = $derived(pageSize === null ? null : pageDisplaySize(pageSize, zoom));
  const ordered = $derived(inReadingOrder(marks));
  const numberOf = $derived(new Map(ordered.map((mark, index) => [mark.key, index + 1])));
  const marksOnPage = $derived(ordered.filter((mark) => mark.page === currentPage));
  const pagesWithMarks = $derived(new Set(marks.map((mark) => mark.page)));
  const reasonItems = REDACTION_REASONS.map((reason) => ({ value: reason, label: reason }));
  const applyLabel = $derived(
    marks.length === 1 ? "Apply 1 Redaction" : `Apply ${marks.length} Redactions`,
  );

  async function paint(canvas: HTMLCanvasElement | null, index: number, atZoom: number): Promise<void> {
    const engine = source;
    if (engine === null || canvas === null) return;
    const outcome = await engine.render(index, renderDpiFor(atZoom, window.devicePixelRatio));
    if (gone || "failure" in outcome) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    canvas.width = outcome.page.width;
    canvas.height = outcome.page.height;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(outcome.page.data), outcome.page.width, outcome.page.height),
      0,
      0,
    );
  }

  async function open(): Promise<void> {
    const opened = await openEditorDocument(
      file,
      "This document has a password. Unlock it in the File Workbench, save the unlocked copy, and redact that.",
    );
    if (gone) {
      if (opened.kind === "ready") opened.source.close();
      return;
    }
    if (opened.kind === "refused") {
      phase = { kind: "refused", message: opened.message };
      return;
    }
    source = opened.source;
    original = opened.original;
    pages = opened.pages;
    phase = { kind: "ready" };
  }

  onMount(() => {
    void open();
    return () => {
      gone = true;
      source?.close();
      source = null;
    };
  });

  // The page in view is redrawn whenever it, or the zoom, changes.
  $effect(() => {
    if (phase.kind !== "ready") return;
    void paint(pageCanvas, currentPage, zoom);
  });

  // The side list draws each page small once, as its canvas arrives.
  $effect(() => {
    if (phase.kind !== "ready") return;
    thumbnailCanvases.forEach((canvas, index) => {
      if (canvas === null || paintedThumbnails.has(index)) return;
      paintedThumbnails.add(index);
      void paint(canvas, index, THUMBNAIL_ZOOM);
    });
  });

  function pointIn(event: PointerEvent): { x: number; y: number } {
    const target = event.currentTarget as HTMLElement;
    const bounds = target.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function beginDraw(event: PointerEvent): void {
    if (display === null || event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragStart = pointIn(event);
    dragBox = null;
  }

  function continueDraw(event: PointerEvent): void {
    if (dragStart === null || display === null) return;
    dragBox = boxBetween(dragStart, pointIn(event), display.width, display.height);
  }

  function addMark(page: number, rect: MarkedRedaction["rect"], wholePage: boolean): void {
    const key = `mark-${nextKey}`;
    nextKey += 1;
    marks = [...marks, { key, page, rect, reason: defaultReason, wholePage }];
    selectedKey = key;
    result = { kind: "idle" };
  }

  function endDraw(): void {
    const box = dragBox;
    dragStart = null;
    dragBox = null;
    if (box === null || pageSize === null || !isDeliberateMark(box)) return;
    addMark(currentPage, screenToPoints(box, pageSize, zoom), false);
  }

  function markWholePage(): void {
    if (pageSize === null) return;
    addMark(currentPage, wholePageRect(pageSize), true);
  }

  function removeMark(key: string): void {
    marks = marks.filter((mark) => mark.key !== key);
    if (selectedKey === key) selectedKey = null;
  }

  function setReason(key: string, reason: RedactionReason): void {
    marks = marks.map((mark) => (mark.key === key ? { ...mark, reason } : mark));
    defaultReason = reason;
  }

  function stepZoom(by: -1 | 1): void {
    zoomIndex = Math.min(ZOOM_FACTORS.length - 1, Math.max(0, zoomIndex + by));
  }

  function boxStyle(box: ScreenRect): string {
    return `left: ${box.left}px; top: ${box.top}px; width: ${box.width}px; height: ${box.height}px`;
  }

  async function apply(): Promise<void> {
    if (original === null || marks.length === 0 || result.kind === "applying") return;
    result = { kind: "applying" };
    const applied = [...marks];
    const reply = await runPdfOperation(original.slice(0), {
      kind: "redact",
      regions: engineRegions(applied),
      removeHiddenData,
    });
    if (gone) return;
    if (reply.kind === "failed") {
      result = { kind: "failed", message: describeOperationFailure(reply.reason, reply.message) };
      return;
    }
    const name = redactedCopyName(file.name);
    const made = reply.documents[0];
    if (made === undefined) {
      result = { kind: "failed", message: describeOperationFailure("refused", "") };
      return;
    }
    const filed = await fileMadeDocument(file, made, name);
    if (gone) return;
    if (filed.kind === "notFiled") {
      result = {
        kind: "downloadOnly",
        url: filed.url,
        name,
        why: "The redacted copy was made but couldn't be saved to the matter. Download it now; nothing was saved.",
      };
      return;
    }
    if (saveLog) {
      const csv = redactionLogCsv(name, redactionLog(applied), new Date().toISOString());
      const logName = name.replace(/\.pdf$/i, "") + " Log.csv";
      await uploadIntoFolder({
        fetchImpl: fetch,
        matterId: file.matterId,
        folderId: file.folderId,
        file: new File([csv], logName, { type: "text/csv" }),
        name: logName,
      });
    }
    marks = [];
    selectedKey = null;
    result = { kind: "saved", fileId: filed.fileId, name, pages: reply.pagesChanged };
  }
</script>

{#if phase.kind === "opening"}
  <p class="p-24 text-sm text-text-muted" role="status">Reading the document</p>
{:else if phase.kind === "refused"}
  <div class="p-24">
    <Alert.Root variant="warning">
      <Alert.Title>This Document Can't Be Redacted Here</Alert.Title>
      <Alert.Description>{phase.message}</Alert.Description>
    </Alert.Root>
  </div>
{:else}
  <div class="flex min-h-0 flex-1">
    <!-- The pages, small. A mark on a page puts a rule under its number. -->
    <nav aria-label="Pages" class="mc-scrollbar flex min-h-0 w-128 shrink-0 flex-col items-center gap-12 overflow-auto border-e border-border-default p-12">
      {#each pages as size, index (index)}
        {@const thumb = pageDisplaySize(size, THUMBNAIL_ZOOM * 2.2)}
        <button
          type="button"
          class="flex flex-col items-center gap-4 rounded-sm"
          aria-current={index === currentPage ? "page" : undefined}
          aria-label="Page {index + 1}{pagesWithMarks.has(index) ? ', has redactions' : ''}"
          onclick={() => (currentPage = index)}
        >
          <span
            class="block border bg-surface-raised {index === currentPage ? 'border-accent-default ring-2 ring-accent-default' : 'border-border-default'}"
            style="width: {thumb.width}px; height: {thumb.height}px"
          >
            <canvas bind:this={thumbnailCanvases[index]} class="block h-full w-full"></canvas>
          </span>
          <span class="text-xs tabular-nums {pagesWithMarks.has(index) ? 'font-semibold text-status-danger' : 'text-text-muted'}">
            {index + 1}
          </span>
        </button>
      {/each}
    </nav>

    <!-- The page being worked on. -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-sunken">
      <div class="flex flex-none items-center gap-8 border-b border-border-default bg-surface-default px-12 py-8">
        <Button variant="secondary" size="sm" onclick={markWholePage}>
          <FileX class="size-16" aria-hidden="true" />
          Redact Whole Page
        </Button>
        <span class="text-sm text-text-muted">Drag on the page to mark a box.</span>
        <span class="ms-auto flex items-center gap-4">
          <span class="text-sm tabular-nums text-text-muted">Page {currentPage + 1} of {pages.length}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Show the page smaller" disabled={zoomIndex === 0} onclick={() => stepZoom(-1)}>
            <ZoomOut class="size-16" aria-hidden="true" />
          </Button>
          <span class="w-48 text-center text-xs tabular-nums text-text-muted">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon-sm" aria-label="Show the page larger" disabled={zoomIndex === ZOOM_FACTORS.length - 1} onclick={() => stepZoom(1)}>
            <ZoomIn class="size-16" aria-hidden="true" />
          </Button>
        </span>
      </div>
      <div class="mc-scrollbar flex min-h-0 flex-1 justify-center overflow-auto p-16">
        {#if display !== null}
          <div
            class="relative flex-none cursor-crosshair touch-none select-none border border-border-default bg-surface-raised"
            style="width: {display.width}px; height: {display.height}px"
            role="application"
            aria-label="Page {currentPage + 1}. Drag to mark a region for redaction."
            onpointerdown={beginDraw}
            onpointermove={continueDraw}
            onpointerup={endDraw}
            onpointercancel={endDraw}
          >
            <canvas bind:this={pageCanvas} class="pointer-events-none block h-full w-full"></canvas>
            {#each marksOnPage as mark (mark.key)}
              {@const box = pointsToScreen(mark.rect, pageSize as PdfPageSize, zoom)}
              <div
                class="pointer-events-none absolute border-2 border-dashed border-status-danger bg-status-danger-subtle/60 {selectedKey === mark.key ? 'ring-2 ring-status-danger' : ''}"
                style={boxStyle(box)}
              >
                <span class="absolute -top-20 start-0 rounded-xs bg-status-danger px-4 text-xs font-semibold text-status-danger-foreground">
                  {numberOf.get(mark.key)}
                </span>
              </div>
            {/each}
            {#if dragBox !== null}
              <div class="pointer-events-none absolute border-2 border-status-danger bg-status-danger-subtle/60" style={boxStyle(dragBox)}></div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    <!-- The marks, their reasons, and the one act that applies them. -->
    <aside aria-label="Redactions" class="flex min-h-0 w-352 shrink-0 flex-col border-s border-border-default bg-surface-default">
      <div class="flex flex-none items-center gap-8 px-16 pt-16 pb-8">
        <h2 class="text-sm font-semibold">Redactions</h2>
        <span class="rounded-full bg-surface-selected px-8 text-xs font-semibold tabular-nums">{marks.length}</span>
      </div>
      <div class="mc-scrollbar min-h-0 flex-1 overflow-auto">
        <DataTable.Root class="w-full">
          <DataTable.Header>
            <DataTable.Row>
              <DataTable.Head>#</DataTable.Head>
              <DataTable.Head>Page</DataTable.Head>
              <DataTable.Head>Reason</DataTable.Head>
              <DataTable.Head><span class="sr-only">Remove</span></DataTable.Head>
            </DataTable.Row>
          </DataTable.Header>
          <DataTable.Body>
            {#each ordered as mark, index (mark.key)}
              <DataTable.Row data-state={selectedKey === mark.key ? "selected" : undefined}>
                <DataTable.Cell class="tabular-nums">{index + 1}</DataTable.Cell>
                <DataTable.Cell class="tabular-nums">
                  <button
                    type="button"
                    class="underline-offset-2 hover:underline"
                    aria-label="Show redaction {index + 1} on page {mark.page + 1}"
                    onclick={() => {
                      selectedKey = mark.key;
                      currentPage = mark.page;
                    }}
                  >
                    {mark.page + 1}{mark.wholePage ? " (Whole)" : ""}
                  </button>
                </DataTable.Cell>
                <DataTable.Cell>
                  <Select.Root
                    type="single"
                    items={reasonItems}
                    bind:value={() => mark.reason, (picked) => setReason(mark.key, (picked || mark.reason) as RedactionReason)}
                  >
                    <Select.Trigger aria-label="Reason for redaction {index + 1}">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      {#each reasonItems as item (item.value)}
                        <Select.Item value={item.value} label={item.label} />
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </DataTable.Cell>
                <DataTable.Cell class="text-end">
                  <Button variant="ghost" size="icon-sm" aria-label="Remove redaction {index + 1}" onclick={() => removeMark(mark.key)}>
                    <Trash2 class="size-16" aria-hidden="true" />
                  </Button>
                </DataTable.Cell>
              </DataTable.Row>
            {:else}
              <DataTable.Row>
                <DataTable.Cell colspan={4} class="text-text-muted">No regions marked.</DataTable.Cell>
              </DataTable.Row>
            {/each}
          </DataTable.Body>
        </DataTable.Root>
        <div class="flex flex-col gap-12 px-16 py-16">
          <div class="flex items-start gap-8">
            <Checkbox id="redact-remove-hidden" checked={removeHiddenData} onCheckedChange={(checked) => (removeHiddenData = checked)} />
            <Label for="redact-remove-hidden">Also remove hidden data (metadata, attachments, form values, bookmarks)</Label>
          </div>
          <div class="flex items-start gap-8">
            <Checkbox id="redact-save-log" checked={saveLog} onCheckedChange={(checked) => (saveLog = checked)} />
            <Label for="redact-save-log">Save a redaction log beside the copy</Label>
          </div>
        </div>
      </div>
      <div class="flex flex-none flex-col gap-8 border-t border-border-default p-16">
        {#if result.kind === "saved"}
          <Alert.Root variant="success">
            <Alert.Title>Saved {result.name}</Alert.Title>
            <Alert.Description>
              {result.pages === 1 ? "1 page" : `${result.pages} pages`} redacted. The original is unchanged.
            </Alert.Description>
            <Button variant="secondary" size="sm" class="self-start" href={viewerHref(result.fileId)}>Open the Redacted Copy</Button>
          </Alert.Root>
        {:else if result.kind === "downloadOnly"}
          <Alert.Root variant="warning">
            <Alert.Title>Not Filed</Alert.Title>
            <Alert.Description>{result.why}</Alert.Description>
            <Button variant="secondary" size="sm" class="self-start" href={result.url} download={result.name}>Download</Button>
          </Alert.Root>
        {:else if result.kind === "failed"}
          <Alert.Root variant="danger">
            <Alert.Title>Nothing Was Redacted</Alert.Title>
            <Alert.Description>{result.message}</Alert.Description>
          </Alert.Root>
        {/if}
        <Button
          variant="destructive"
          disabled={marks.length === 0 || result.kind === "applying"}
          onclick={apply}
        >
          <EyeOff class="size-16" aria-hidden="true" />
          {result.kind === "applying" ? "Applying" : applyLabel}
        </Button>
        <p class="text-center text-xs text-text-muted">Saves a redacted copy beside the original, which stays as it is.</p>
      </div>
    </aside>
  </div>
{/if}
