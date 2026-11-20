<script lang="ts">
  /*
   * A PDF's pages, one under another, fitted to the width they are given and never drawn larger than
   * the page's own size. For a reader who only reads: no tools, no fields over the page.
   *
   * The pages are drawn by the firm's own engine in a worker (./pdf-pages.ts), so the PDF is never
   * handed to the browser's own viewer. Each page is drawn once, at the resolution its full size
   * needs on this screen, and only scaled down on screen after that, so turning a phone or resizing
   * a window costs no redraw.
   *
   * The bytes handed in are COPIED before they go to the worker, because the worker takes the
   * buffer it is given; the caller may still save the same bytes afterwards.
   */
  import { onDestroy } from "svelte";
  import * as Alert from "@magna-carta/design-system/alert";
  import {
    PdfDocumentSource,
    fittedZoom,
    pageDisplaySize,
    pdfWorkerAvailable,
    renderDpiFor,
    type PdfPageSize,
  } from "./pdf-pages.ts";

  let { bytes, label }: { bytes: ArrayBuffer; label: string } = $props();

  type State =
    | { readonly kind: "opening" }
    | { readonly kind: "failed" }
    | { readonly kind: "shown"; readonly pages: readonly PdfPageSize[] };

  let stack = $state<State>({ kind: "opening" });
  let width = $state(0);
  let canvases = $state<(HTMLCanvasElement | null)[]>([]);
  let source: PdfDocumentSource | null = null;
  let gone = false;
  const painted = new Set<number>();

  /** The zoom that fits the widest page in the space given, never past the page's own size. */
  const zoom = $derived(stack.kind === "shown" ? fittedZoom(stack.pages, width) : 1);

  async function open(given: ArrayBuffer): Promise<void> {
    if (!pdfWorkerAvailable()) {
      stack = { kind: "failed" };
      return;
    }
    source = new PdfDocumentSource();
    const refused = await source.open(given.slice(0));
    if (gone) return;
    if (refused !== null) {
      stack = { kind: "failed" };
      return;
    }
    canvases = source.pages.map(() => null);
    stack = { kind: "shown", pages: source.pages };
  }

  async function paint(canvas: HTMLCanvasElement, index: number): Promise<void> {
    if (source === null) return;
    const outcome = await source.render(index, renderDpiFor(1, window.devicePixelRatio));
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

  $effect(() => {
    void open(bytes);
  });

  $effect(() => {
    canvases.forEach((canvas, index) => {
      if (canvas === null || painted.has(index)) return;
      painted.add(index);
      void paint(canvas, index);
    });
  });

  onDestroy(() => {
    gone = true;
    source?.close();
  });
</script>

<div class="w-full" bind:clientWidth={width}>
  {#if stack.kind === "failed"}
    <Alert.Root variant="warning">
      <Alert.Title>Couldn't Show {label}</Alert.Title>
      <Alert.Description>This browser can't show it here. Download it to open it instead.</Alert.Description>
    </Alert.Root>
  {:else if stack.kind === "opening"}
    <p class="text-center text-sm text-text-muted" role="status">Opening {label}</p>
  {:else}
    <div class="flex flex-col items-center gap-16">
      {#each stack.pages as page, index (index)}
        {@const display = pageDisplaySize(page, zoom)}
        <div
          class="flex-none border border-border-default bg-surface-raised"
          style="width: {display.width}px; height: {display.height}px"
          role="img"
          aria-label="{label}, page {index + 1} of {stack.pages.length}"
        >
          <canvas bind:this={canvases[index]} class="block h-full w-full"></canvas>
        </div>
      {/each}
    </div>
  {/if}
</div>
