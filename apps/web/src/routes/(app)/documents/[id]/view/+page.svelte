<script lang="ts">
  /*
   * One document, open for reading. A working surface like the file manager: the header names the
   * document and the way back to the matter's files, and the reader takes the rest of the viewport
   * and keeps it.
   *
   * NOTHING HERE CHANGES THE DOCUMENT. The pages are pixels drawn by the firm's own engine off the
   * main thread ($lib/documents/pdf-pages.ts explains why the file is never handed to the browser
   * to open), and the only act on this screen is the download.
   *
   * ONLY THE PAGES WORTH DRAWING ARE DRAWN. A four-hundred page document rasterized on open is
   * minutes of work and gigabytes of pixels for a reader who wanted page one, so a page is drawn
   * when it comes near the viewport and the drawings are kept in a small cache keyed by the page
   * and the zoom. Every page frame stands at its true size from the moment the document opens,
   * whether or not it has been drawn, so the scrollbar tells the truth about the document's length
   * before a single page has been rasterized.
   */
  import { onMount } from "svelte";
  import { invalidateAll } from "$app/navigation";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import * as Alert from "@magna-carta/design-system/alert";
  import type { AlertVariant } from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import FullHeightSection from "$lib/components/full-height-section.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { readDocumentBytes } from "$lib/documents/document-bytes.ts";
  import {
    formatDocumentSize,
    formatDocumentTimestamp,
  } from "$lib/documents/document-presentation.ts";
  import {
    PDF_VIEWER_MAX_BYTES,
    PdfDocumentSource,
    pageDisplaySize,
    pdfWorkerAvailable,
    renderDpiFor,
    type PdfFailureReason,
    type PdfPageSize,
    type PdfRenderedPage,
  } from "$lib/documents/pdf-pages.ts";
  import { fileDownloadUrl } from "$lib/file-manager/matter-file-api.ts";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { matterFilesBack } from "$lib/screen/screen-header.ts";
  import type { DocumentViewPageData } from "./+page.ts";

  let { data }: { data: DocumentViewPageData } = $props();

  const file = $derived(data.file ?? null);
  const filesBack = $derived(
    file === null ? null : matterFilesBack(file.matterId, data.matter?.title ?? "Files", file.id),
  );

  /** The sizes a reader steps through. Fixed stops, so the two controls are the whole vocabulary. */
  const ZOOM_FACTORS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  /** Where the ladder rests when a document opens: the page at about its physical size. */
  const RESTING_ZOOM_INDEX = 2;

  /**
   * How far outside the viewport a page is still worth drawing. A reader scrolls faster than a
   * page rasterizes, so the pages just past each edge are drawn before they are asked for.
   */
  const NEARBY_MARGIN = "800px 0px";

  /**
   * How many drawn pages are kept. A page at reading size is tens of megabytes of pixels, so the
   * cache holds the neighbourhood a reader moves within and lets the rest go; the oldest drawing
   * is the one furthest behind the reader.
   */
  const DRAWING_CACHE_LIMIT = 36;

  /** The shape the loading state stands in for: one page at United States letter size. */
  const LETTER_PAGE: PdfPageSize = { widthPt: 612, heightPt: 792 };

  /** Why the viewer will not open this document, in the words the reader gets. */
  interface Refusal {
    readonly variant: AlertVariant;
    readonly title: string;
    readonly description: string;
  }

  const BROWSER_HAS_NO_READER: Refusal = {
    variant: "info",
    title: "This Browser Cannot Open the Reader",
    description:
      "The reader draws each page in a background worker this browser does not provide. Download " +
      "the document to read it.",
  };

  const OPEN_REFUSALS: Record<PdfFailureReason, Refusal> = {
    unreadable: {
      variant: "warning",
      title: "This Document Could Not Be Read",
      description:
        "Its bytes are not a PDF the reader can open. Download it and open it in the application " +
        "it was written in.",
    },
    "decompression-bomb": {
      variant: "warning",
      title: "This Document Was Refused as Unsafe to Open",
      description:
        "It expands far past what a page is expected to hold, so the reader stopped rather than " +
        "opening it. It is stored on the matter and it can be downloaded.",
    },
    "render-failed": {
      variant: "warning",
      title: "This Document Could Not Be Opened",
      description:
        "The reader stopped before it could read the document's pages. Download it and open it in " +
        "the application it was written in.",
    },
  };

  /** Whether a page has been drawn, is waiting to be, or could not be. */
  type PageState = "blank" | "drawn" | "failed";

  let zoomIndex = $state(RESTING_ZOOM_INDEX);
  let opening = $state(true);
  let refusal = $state<Refusal | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let pages = $state<readonly PdfPageSize[]>([]);
  let pageStates = $state<PageState[]>([]);
  let currentPage = $state(1);

  const zoom = $derived(ZOOM_FACTORS[zoomIndex] ?? 1);
  const nothingToSize = $derived(pages.length === 0);
  const atSmallest = $derived(zoomIndex === 0);
  const atLargest = $derived(zoomIndex === ZOOM_FACTORS.length - 1);
  const position = $derived(nothingToSize ? "" : `Page ${currentPage} of ${pages.length}`);

  /*
   * What a size control says on hover. A control the reader cannot press says why it cannot be
   * pressed, which is a different sentence from what pressing it would do, and there are two
   * reasons it can be refused: nothing is open, or the ladder has no further rung this way.
   */
  const smallerTitle = $derived.by((): string => {
    if (nothingToSize) return "There are no pages to size.";
    return atSmallest ? "This is the smallest size." : "Show the pages smaller";
  });
  const largerTitle = $derived.by((): string => {
    if (nothingToSize) return "There are no pages to size.";
    return atLargest ? "This is the largest size." : "Show the pages larger";
  });

  // The engine and the drawings are machinery rather than something a template reads, so they are
  // plain values; the elements are state because the watches below are rebuilt when they arrive.
  let source: PdfDocumentSource | null = null;
  let scrollRoot = $state<HTMLDivElement | null>(null);
  let frames = $state<(HTMLDivElement | null)[]>([]);
  let canvases = $state<(HTMLCanvasElement | null)[]>([]);
  /** The zoom each canvas currently shows, so a page is redrawn only when its size moved. */
  let drawnAt: number[] = [];
  const drawings = new Map<string, PdfRenderedPage>();
  const inFlight = new Set<string>();
  /** The pages near enough to the viewport to be worth drawing. */
  const nearby = new Set<number>();
  /** The pages actually on screen, which is what the position in the toolbar reports. */
  const onScreen = new Set<number>();
  /** Set when the screen goes away, so a read that lands afterwards touches nothing. */
  let gone = false;

  function drawingKey(index: number, atZoom: number): string {
    return `${index}@${atZoom}`;
  }

  function remember(key: string, drawn: PdfRenderedPage): void {
    drawings.set(key, drawn);
    while (drawings.size > DRAWING_CACHE_LIMIT) {
      const oldest = drawings.keys().next();
      if (oldest.done === true) break;
      drawings.delete(oldest.value);
    }
  }

  function paint(index: number, drawn: PdfRenderedPage, atZoom: number): void {
    const canvas = canvases[index] ?? null;
    if (canvas === null) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    // The bitmap's own pixels are the canvas's intrinsic size; the frame's CSS size is what the
    // reader sees, so a display drawing more pixels than it shows gets the finer image.
    canvas.width = drawn.width;
    canvas.height = drawn.height;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(drawn.data), drawn.width, drawn.height),
      0,
      0,
    );
    drawnAt[index] = atZoom;
    pageStates[index] = "drawn";
  }

  async function draw(index: number): Promise<void> {
    const engine = source;
    if (engine === null) return;
    const atZoom = zoom;
    if (drawnAt[index] === atZoom) return;
    const key = drawingKey(index, atZoom);
    const kept = drawings.get(key);
    if (kept !== undefined) {
      paint(index, kept, atZoom);
      return;
    }
    if (inFlight.has(key)) return;
    inFlight.add(key);
    const outcome = await engine.render(index, renderDpiFor(atZoom, window.devicePixelRatio));
    inFlight.delete(key);
    if (gone || source !== engine) return;
    if ("failure" in outcome) {
      // The document still reads: only this page says it could not be drawn.
      if (atZoom === zoom) pageStates[index] = "failed";
      return;
    }
    remember(key, outcome.page);
    // The reader moved the zoom while this was drawing; the drawing is kept and the frame waits
    // for the one at the size it now stands at.
    if (atZoom !== zoom) return;
    paint(index, outcome.page, atZoom);
  }

  function drawNearby(): void {
    for (const index of nearby) void draw(index);
  }

  function reportPosition(): void {
    if (onScreen.size === 0) return;
    currentPage = Math.min(...onScreen) + 1;
  }

  function indexOfFrame(element: Element): number | null {
    const marked = element.getAttribute("data-page-index");
    if (marked === null) return null;
    const index = Number(marked);
    return Number.isInteger(index) ? index : null;
  }

  function stepZoom(by: -1 | 1): void {
    const next = Math.min(ZOOM_FACTORS.length - 1, Math.max(0, zoomIndex + by));
    if (next === zoomIndex) return;
    zoomIndex = next;
    // A page that failed at the old size is asked again at the new one, so a single bad draw does
    // not follow the reader down the ladder.
    pageStates = pageStates.map((state) => (state === "failed" ? "blank" : state));
    drawNearby();
  }

  function forget(): void {
    source?.close();
    source = null;
    drawings.clear();
    inFlight.clear();
    nearby.clear();
    onScreen.clear();
    frames = [];
    canvases = [];
    drawnAt = [];
  }

  /** Read the document's bytes and open them. Retry asks again for the same document. */
  async function open(): Promise<void> {
    if (file === null) return;
    forget();
    pages = [];
    pageStates = [];
    currentPage = 1;
    refusal = null;
    readFailure = null;
    opening = true;

    if (!pdfWorkerAvailable()) {
      refusal = BROWSER_HAS_NO_READER;
      opening = false;
      return;
    }

    const outcome = await readDocumentBytes(fetch, file.id, file.sizeBytes, PDF_VIEWER_MAX_BYTES);
    if (gone) return;
    if (outcome.kind === "too-large") {
      refusal = {
        variant: "warning",
        title: "This Document Is Larger Than the Viewer Opens",
        description:
          `It is ${formatDocumentSize(outcome.sizeBytes)}; the viewer opens up to ` +
          `${formatDocumentSize(PDF_VIEWER_MAX_BYTES)}. Download it to read it.`,
      };
      opening = false;
      return;
    }
    if (outcome.kind !== "ok") {
      readFailure = stated(
        outcome.failure,
        "The document could not be read.",
        "Nothing answered when the document was read.",
      );
      opening = false;
      return;
    }

    const engine = new PdfDocumentSource();
    source = engine;
    // The buffer is transferred here, not copied: it is empty afterwards and is never read again.
    const reason = await engine.open(outcome.bytes);
    if (gone || source !== engine) {
      engine.close();
      return;
    }
    if (reason !== null) {
      engine.close();
      source = null;
      refusal = OPEN_REFUSALS[reason];
      opening = false;
      return;
    }
    pages = engine.pages;
    pageStates = engine.pages.map(() => "blank");
    drawnAt = engine.pages.map(() => Number.NaN);
    opening = false;
  }

  onMount(() => {
    void open();
    return () => {
      gone = true;
      forget();
    };
  });

  /*
   * Two watches over the page frames, because they answer two questions with two reaches. The
   * first draws what is near the viewport; the second, which sees only what is genuinely on
   * screen, is what the toolbar's position reads. One observer with a margin would report a page
   * the reader cannot see.
   */
  $effect(() => {
    if (pages.length === 0) return;
    const root = scrollRoot;
    if (root === null) return;
    const drawWatch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = indexOfFrame(entry.target);
          if (index === null) continue;
          if (entry.isIntersecting) nearby.add(index);
          else nearby.delete(index);
        }
        drawNearby();
      },
      { root, rootMargin: NEARBY_MARGIN },
    );
    const positionWatch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = indexOfFrame(entry.target);
          if (index === null) continue;
          if (entry.isIntersecting) onScreen.add(index);
          else onScreen.delete(index);
        }
        reportPosition();
      },
      { root },
    );
    for (const frame of frames) {
      if (frame === null) continue;
      drawWatch.observe(frame);
      positionWatch.observe(frame);
    }
    return () => {
      drawWatch.disconnect();
      positionWatch.disconnect();
      nearby.clear();
      onScreen.clear();
    };
  });

  /** A page's size on screen. A runtime dimension, so it rides inline. */
  function frameStyle(size: PdfPageSize, atZoom: number): string {
    const display = pageDisplaySize(size, atZoom);
    return `width: ${display.width}px; height: ${display.height}px`;
  }
</script>

<svelte:head>
  <title>{file === null ? "Document" : file.name} · Magna Carta</title>
</svelte:head>

{#snippet downloadAction(fileId: string)}
  <Button
    variant="secondary"
    size="sm"
    class="self-start"
    href={fileDownloadUrl(fileId)}
    {...opensBeside("file")}
  >
    Download
  </Button>
{/snippet}

{#if data.failure !== undefined}
  <ScreenHeader title="Document" class="mb-24" />
  <FailureNotice
    failure={data.failure}
    subject="The document"
    fallback="The document could not be read."
    whenSilent="Nothing answered when the document was read."
    onRetry={() => void invalidateAll()}
  />
{:else if file !== null && filesBack !== null}
  <!-- The matter chrome's own arrangement: a full-height flex column, so the reader below can take
       exactly the remaining viewport height. The header is flex-none so it never gives way. -->
  <div class="flex min-h-full flex-col">
    <ScreenHeader title={file.name} back={filesBack} class="mb-24 flex-none">
      {#snippet meta()}
        <span>Version {file.versionNumber}</span>
        <Masthead.MetaSeparator />
        <span>{formatDocumentSize(file.sizeBytes)}</span>
        <Masthead.MetaSeparator />
        <span>{formatDocumentTimestamp(file.updatedAt)}</span>
      {/snippet}
    </ScreenHeader>

    <!-- Edge to edge: the horizontal margins cancel the work canvas's padding, so the reader runs
         to the canvas's edges like the file manager's list does. -->
    <FullHeightSection class="-mx-24">
      {#if refusal !== null}
        <div class="p-24">
          <Alert.Root variant={refusal.variant}>
            <Alert.Title>{refusal.title}</Alert.Title>
            <Alert.Description>{refusal.description}</Alert.Description>
            {@render downloadAction(file.id)}
          </Alert.Root>
        </div>
      {:else}
        <!-- The strip sits flush under the header, one row: where the reader is at its inline
             start, the size and the download at its inline end. -->
        <div class="flex flex-none items-center gap-12 border-b border-border-default px-8 py-4">
          <span class="text-sm text-text-muted">{position}</span>
          <span class="ms-auto flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={atSmallest || nothingToSize}
              title={smallerTitle}
              aria-label="Show the pages smaller"
              onclick={() => stepZoom(-1)}
            >
              <ZoomOut class="size-16" aria-hidden="true" />
            </Button>
            <span
              class="w-48 text-center text-xs tabular-nums text-text-muted"
              role="status"
              aria-live="polite"
            >
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={atLargest || nothingToSize}
              title={largerTitle}
              aria-label="Show the pages larger"
              onclick={() => stepZoom(1)}
            >
              <ZoomIn class="size-16" aria-hidden="true" />
            </Button>
          </span>
          <Button
            variant="secondary"
            size="sm"
            href={fileDownloadUrl(file.id)}
            {...opensBeside("file")}
          >
            Download
          </Button>
        </div>

        <LoadingRegion
          loading={opening}
          failed={readFailure !== null}
          empty={!opening && pages.length === 0}
          label="Reading the document"
          onRetry={open}
          class="flex min-h-0 flex-1 flex-col"
        >
          {#snippet failure()}
            {#if readFailure !== null}
              <div class="p-24">
                <FailureNotice
                  failure={readFailure.failure}
                  subject="The document"
                  fallback={readFailure.fallback}
                  whenSilent={readFailure.whenSilent}
                  onRetry={open}
                />
              </div>
            {/if}
          {/snippet}

          {#snippet emptyState()}
            <div class="flex min-h-0 flex-1 flex-col justify-center p-24">
              <EmptyState title="This Document Has No Pages">
                {#snippet actions()}
                  {@render downloadAction(file.id)}
                {/snippet}
              </EmptyState>
            </div>
          {/snippet}

          {#snippet fixture()}
            <div class="flex min-h-0 flex-1 flex-col items-center gap-16 overflow-hidden p-16">
              <div
                class="flex flex-none items-center justify-center border border-border-default bg-surface-raised"
                style={frameStyle(LETTER_PAGE, 1)}
              >
                <canvas class="block h-full w-full"></canvas>
              </div>
            </div>
          {/snippet}

          <div
            bind:this={scrollRoot}
            class="mc-scrollbar flex min-h-0 flex-1 flex-col items-center gap-16 overflow-auto bg-surface-sunken p-16"
          >
            {#each pages as size, index (index)}
              <div
                bind:this={frames[index]}
                data-page-index={index}
                class="flex flex-none items-center justify-center border border-border-default bg-surface-raised"
                style={frameStyle(size, zoom)}
              >
                {#if pageStates[index] === "failed"}
                  <p class="p-16 text-center text-sm text-text-muted">
                    This page could not be drawn.
                  </p>
                {:else}
                  <canvas
                    bind:this={canvases[index]}
                    class="block h-full w-full"
                    aria-label="Page {index + 1}"
                  ></canvas>
                {/if}
              </div>
            {/each}
          </div>
        </LoadingRegion>
      {/if}
    </FullHeightSection>
  </div>
{/if}
