<script lang="ts">
  /*
   * The PDF Editor's Pages tab: put the pages in a new order, turn them, take some out, and save
   * the result as the next version of the file. Some of the pages can also be taken out into a new
   * file, or the document split into several files at chosen pages.
   *
   * NOTHING CHANGES UNTIL SAVE. Every move, turn and delete is made to an arrangement held on this
   * screen (`page-arrangement.ts`), and Reset puts it back. Saving hands the arrangement to the
   * firm's own engine in a worker, which makes the new document. Saving files it as a new VERSION,
   * so the version before it stays in the file's history; extracting and splitting file NEW files
   * beside the original, which itself is left as it is.
   *
   * A page is chosen by pressing it; Shift chooses the run from the last page pressed. A choice of
   * pages is dragged as one block, or moved a place at a time with Move Earlier and Move Later,
   * which is the keyboard's way to reorder.
   */
  import { onMount } from "svelte";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Check from "@lucide/svelte/icons/check";
  import Files from "@lucide/svelte/icons/files";
  import RotateCcw from "@lucide/svelte/icons/rotate-ccw";
  import RotateCw from "@lucide/svelte/icons/rotate-cw";
  import Save from "@lucide/svelte/icons/save";
  import Scissors from "@lucide/svelte/icons/scissors";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import {
    ITEM_DRAG_KEY_ATTRIBUTE,
    ITEM_DROP_KEY_ATTRIBUTE,
    createItemDrag,
  } from "@magna-carta/design-system/item-drag";
  import { viewerHref } from "$lib/documents/editable-documents.ts";
  import { PdfDocumentSource, pageDisplaySize, renderDpiFor, type PdfPageSize } from "$lib/documents/pdf-pages.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { fileMadeDocument, openEditorDocument, type Filed } from "./editor-document.ts";
  import {
    buildPlan,
    extractedCopyName,
    initialArrangement,
    isUnchanged,
    movePages,
    nudgePages,
    partName,
    removePages,
    splitAt,
    turnPages,
    wasMoved,
    type ArrangedPage,
  } from "./page-arrangement.ts";
  import { describeOperationFailure, runPdfOperation } from "./pdf-operations.ts";

  let { file, onSaved }: { file: MatterFile; onSaved: () => void } = $props();

  /** How large a page is drawn in the grid, as a zoom on the reader's 100%. */
  const GRID_ZOOM = 0.2;
  /** The drop target that means "after the last page". Page keys are numbers, so it cannot collide. */
  const END_KEY = "end";

  type Phase =
    | { readonly kind: "opening" }
    | { readonly kind: "refused"; readonly message: string }
    | { readonly kind: "ready" };

  type Result =
    | { readonly kind: "idle" }
    | { readonly kind: "working"; readonly what: string }
    | { readonly kind: "filed"; readonly files: readonly Filed[]; readonly asVersion: boolean }
    | { readonly kind: "failed"; readonly message: string };

  let phase = $state<Phase>({ kind: "opening" });
  let sizes = $state<readonly PdfPageSize[]>([]);
  let pages = $state<ArrangedPage[]>([]);
  let chosen = $state<ReadonlySet<number>>(new Set());
  let lastPressed = $state<number | null>(null);
  let result = $state<Result>({ kind: "idle" });
  let canvases = $state<Record<number, HTMLCanvasElement | null>>({});

  let source: PdfDocumentSource | null = null;
  let original: ArrayBuffer | null = null;
  /** Pages already drawn. A page is drawn once; turning it turns the drawing, not the page. */
  const painted = new Set<number>();
  let gone = false;

  const busy = $derived(result.kind === "working");
  const changed = $derived(!isUnchanged(pages, sizes.length));
  const chosenInOrder = $derived(pages.filter((page) => chosen.has(page.source)));
  const chosenLabel = $derived(
    chosen.size === 0 ? "No pages chosen" : chosen.size === 1 ? "1 page chosen" : `${chosen.size} pages chosen`,
  );
  const partCount = $derived(splitAt(pages, chosen).length);

  const drag = createItemDrag({
    keysFor: (key) => {
      const page = Number(key);
      return chosen.has(page) ? chosenInOrder.map((one) => String(one.source)) : [key];
    },
    describe: (keys) => `${keys.length} pages`,
    accepts: (keys, targetKey) => !keys.includes(targetKey),
    onDrop: (keys, targetKey) => {
      const moving = new Set(keys.map(Number));
      const before = targetKey === END_KEY ? pages.length : pages.findIndex((page) => String(page.source) === targetKey);
      if (before < 0) return;
      pages = movePages(pages, moving, before);
      result = { kind: "idle" };
    },
  });
  const handlers = $derived(drag.handlers());

  async function paint(canvas: HTMLCanvasElement, index: number): Promise<void> {
    const engine = source;
    if (engine === null) return;
    const outcome = await engine.render(index, renderDpiFor(GRID_ZOOM, window.devicePixelRatio));
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
      "This document is locked with a password. Unlock it in the File Workbench, save the unlocked copy, and arrange that.",
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
    sizes = opened.pages;
    pages = initialArrangement(opened.pages.length);
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

  $effect(() => {
    if (phase.kind !== "ready") return;
    for (const [key, canvas] of Object.entries(canvases)) {
      const index = Number(key);
      if (canvas === null || painted.has(index)) continue;
      painted.add(index);
      void paint(canvas, index);
    }
  });

  function press(event: MouseEvent, page: number): void {
    const next = new Set(chosen);
    if (event.shiftKey && lastPressed !== null) {
      const from = pages.findIndex((one) => one.source === lastPressed);
      const to = pages.findIndex((one) => one.source === page);
      const [low, high] = from < to ? [from, to] : [to, from];
      for (const one of pages.slice(low, high + 1)) next.add(one.source);
    } else if (next.has(page)) {
      next.delete(page);
    } else {
      next.add(page);
    }
    chosen = next;
    lastPressed = page;
  }

  function change(next: ArrangedPage[]): void {
    pages = next;
    result = { kind: "idle" };
  }

  function removeChosen(): void {
    change(removePages(pages, chosen));
    chosen = new Set();
  }

  function reset(): void {
    change(initialArrangement(sizes.length));
    chosen = new Set();
  }

  /** The box a page takes in the grid: a turned page lies on its side. */
  function slot(page: ArrangedPage): { width: number; height: number; drawn: { width: number; height: number } } {
    const size = sizes[page.source] ?? { widthPt: 612, heightPt: 792 };
    const drawn = pageDisplaySize(size, GRID_ZOOM);
    const sideways = page.turn === 90 || page.turn === 270;
    return sideways ? { width: drawn.height, height: drawn.width, drawn } : { ...drawn, drawn };
  }

  async function make(plans: ArrangedPage[][], what: string): Promise<Uint8Array[] | null> {
    if (original === null) return null;
    result = { kind: "working", what };
    const reply = await runPdfOperation(original.slice(0), { kind: "arrange", plans: plans.map(buildPlan) });
    if (gone) return null;
    if (reply.kind === "failed") {
      result = { kind: "failed", message: describeOperationFailure(reply.reason, reply.message) };
      return null;
    }
    return [...reply.documents];
  }

  async function save(): Promise<void> {
    if (!changed || pages.length === 0 || busy) return;
    const made = await make([pages], "Saving");
    const document = made?.[0];
    if (document === undefined) return;
    const filed = await fileMadeDocument(file, document, file.name, { asVersionOf: file.id });
    if (gone) return;
    result = { kind: "filed", files: [filed], asVersion: true };
    if (filed.kind === "filed") onSaved();
  }

  async function extract(): Promise<void> {
    if (chosenInOrder.length === 0 || busy) return;
    const made = await make([chosenInOrder], "Extracting");
    const document = made?.[0];
    if (document === undefined) return;
    const name = extractedCopyName(file.name, chosenInOrder.map((page) => page.source));
    const filed = await fileMadeDocument(file, document, name);
    if (gone) return;
    result = { kind: "filed", files: [filed], asVersion: false };
  }

  async function split(): Promise<void> {
    const parts = splitAt(pages, chosen);
    if (parts.length < 2 || busy) return;
    const made = await make(parts, "Splitting");
    if (made === null) return;
    const files: Filed[] = [];
    for (const [index, document] of made.entries()) {
      files.push(await fileMadeDocument(file, document, partName(file.name, index + 1, made.length)));
      if (gone) return;
    }
    result = { kind: "filed", files, asVersion: false };
  }
</script>

{#if phase.kind === "opening"}
  <p class="p-24 text-sm text-text-muted" role="status">Reading the document</p>
{:else if phase.kind === "refused"}
  <div class="p-24">
    <Alert.Root variant="warning">
      <Alert.Title>This Document Cannot Be Arranged Here</Alert.Title>
      <Alert.Description>{phase.message}</Alert.Description>
    </Alert.Root>
  </div>
{:else}
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex flex-none flex-wrap items-center gap-8 border-b border-border-default bg-surface-default px-12 py-8">
      <span class="text-sm text-text-muted" aria-live="polite">{chosenLabel}</span>
      <Button variant="secondary" size="sm" disabled={chosen.size === 0 || busy} onclick={() => change(turnPages(pages, chosen, -90))}>
        <RotateCcw class="size-16" aria-hidden="true" />
        Rotate Left
      </Button>
      <Button variant="secondary" size="sm" disabled={chosen.size === 0 || busy} onclick={() => change(turnPages(pages, chosen, 90))}>
        <RotateCw class="size-16" aria-hidden="true" />
        Rotate Right
      </Button>
      <Button variant="secondary" size="sm" disabled={chosen.size === 0 || busy} onclick={() => change(nudgePages(pages, chosen, -1))}>
        <ArrowLeft class="size-16" aria-hidden="true" />
        Move Earlier
      </Button>
      <Button variant="secondary" size="sm" disabled={chosen.size === 0 || busy} onclick={() => change(nudgePages(pages, chosen, 1))}>
        <ArrowRight class="size-16" aria-hidden="true" />
        Move Later
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={chosen.size === 0 || chosen.size === pages.length || busy}
        onclick={removeChosen}
      >
        <Trash2 class="size-16" aria-hidden="true" />
        Delete
      </Button>
      <span class="h-24 border-s border-border-default" aria-hidden="true"></span>
      <Button variant="secondary" size="sm" disabled={chosen.size === 0 || busy} onclick={extract}>
        <Scissors class="size-16" aria-hidden="true" />
        Extract to New File
      </Button>
      <Button variant="secondary" size="sm" disabled={partCount < 2 || busy} onclick={split}>
        <Files class="size-16" aria-hidden="true" />
        {partCount < 2 ? "Split Into Files" : `Split Into ${partCount} Files`}
      </Button>
      <span class="ms-auto flex items-center gap-8">
        <Button variant="ghost" size="sm" disabled={!changed || busy} onclick={reset}>
          <Undo2 class="size-16" aria-hidden="true" />
          Reset
        </Button>
        <Button size="sm" disabled={!changed || pages.length === 0 || busy} onclick={save}>
          <Save class="size-16" aria-hidden="true" />
          {result.kind === "working" && result.what === "Saving" ? "Saving" : "Save as New Version"}
        </Button>
      </span>
    </div>

    {#if result.kind !== "idle"}
      <div class="flex-none border-b border-border-default px-12 py-8">
        {#if result.kind === "working"}
          <p class="text-sm text-text-muted" role="status">{result.what}</p>
        {:else if result.kind === "failed"}
          <Alert.Root variant="danger">
            <Alert.Title>Nothing Was Saved</Alert.Title>
            <Alert.Description>{result.message}</Alert.Description>
          </Alert.Root>
        {:else}
          {@const notFiled = result.files.filter((one) => one.kind === "notFiled")}
          {#if notFiled.length === 0}
            <Alert.Root variant="success">
              <Alert.Title>
                {result.asVersion ? "Saved as a New Version" : result.files.length === 1 ? "Saved a New File" : `Saved ${result.files.length} New Files`}
              </Alert.Title>
              <Alert.Description>
                {result.asVersion
                  ? "The version before it is still in the file's history."
                  : "The original is unchanged."}
              </Alert.Description>
              {#if !result.asVersion}
                <span class="flex flex-wrap gap-8">
                  {#each result.files as one (one.name)}
                    {#if one.kind === "filed"}
                      <Button variant="secondary" size="sm" href={viewerHref(one.fileId)}>Open {one.name}</Button>
                    {/if}
                  {/each}
                </span>
              {/if}
            </Alert.Root>
          {:else}
            <Alert.Root variant="warning">
              <Alert.Title>Not Filed</Alert.Title>
              <Alert.Description>
                The engine made the {notFiled.length === 1 ? "document" : "documents"}, but the matter did not take
                {notFiled.length === 1 ? "it" : "them"}. Download {notFiled.length === 1 ? "it" : "them"} now; nothing
                below was saved.
              </Alert.Description>
              <span class="flex flex-wrap gap-8">
                {#each notFiled as one (one.name)}
                  {#if one.kind === "notFiled"}
                    <Button variant="secondary" size="sm" href={one.url} download={one.name}>Download {one.name}</Button>
                  {/if}
                {/each}
              </span>
            </Alert.Root>
          {/if}
        {/if}
      </div>
    {/if}

    <div class="mc-scrollbar min-h-0 flex-1 overflow-auto bg-surface-sunken p-24" {...handlers}>
      <ol class="flex flex-wrap items-end gap-24" aria-label="Pages, in their new order">
        {#each pages as page, index (page.source)}
          {@const box = slot(page)}
          {@const isChosen = chosen.has(page.source)}
          <li
            class="flex flex-col items-center gap-8 rounded-sm"
            class:opacity-40={drag.isDragging(String(page.source))}
            {...{ [ITEM_DRAG_KEY_ATTRIBUTE]: String(page.source), [ITEM_DROP_KEY_ATTRIBUTE]: String(page.source) }}
          >
            <button
              type="button"
              class="relative block border bg-surface-raised {isChosen ? 'border-accent-strong ring-2 ring-accent-strong' : 'border-border-default'}"
              style="width: {box.width}px; height: {box.height}px"
              aria-pressed={isChosen}
              aria-label="Page {index + 1}{wasMoved(page, index) ? `, was page ${page.source + 1}` : ''}{page.turn === 0 ? '' : `, turned ${page.turn} degrees`}"
              onclick={(event) => press(event, page.source)}
            >
              <canvas
                bind:this={canvases[page.source]}
                class="pointer-events-none absolute start-1/2 top-1/2 block"
                style="width: {box.drawn.width}px; height: {box.drawn.height}px; transform: translate(-50%, -50%) rotate({page.turn}deg)"
              ></canvas>
              {#if isChosen}
                <span class="absolute end-4 top-4 flex size-20 items-center justify-center rounded-xs bg-accent-strong text-accent-strong-foreground">
                  <Check class="size-16" aria-hidden="true" />
                </span>
              {/if}
            </button>
            <span class="text-xs tabular-nums text-text-muted">
              {index + 1}{wasMoved(page, index) ? ` · was ${page.source + 1}` : ""}{page.turn === 0 ? "" : " · Rotated"}
            </span>
          </li>
        {/each}
        <li
          class="flex h-full min-h-64 w-24 items-center justify-center self-stretch rounded-sm"
          aria-hidden="true"
          {...{ [ITEM_DROP_KEY_ATTRIBUTE]: END_KEY }}
        ></li>
      </ol>
    </div>
  </div>
{/if}
