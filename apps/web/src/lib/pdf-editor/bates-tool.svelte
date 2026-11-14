<script lang="ts">
  /*
   * The PDF Editor's Bates tab: set up the numbering, see it on the first and last page, and stamp
   * a numbered copy filed beside the original.
   *
   * The preview draws the label over the page in the browser; it is a guide to where the label
   * goes and how large it reads, not the engine's own output. The engine draws the real label in a
   * standard PDF font, and the numbered copy is checked by opening it.
   */
  import { onMount } from "svelte";
  import Hash from "@lucide/svelte/icons/hash";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import FieldRow from "@magna-carta/design-system/field-row";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as Select from "@magna-carta/design-system/select";
  import { viewerHref } from "$lib/documents/editable-documents.ts";
  import { PdfDocumentSource, pageDisplaySize, renderDpiFor, type PdfPageSize } from "$lib/documents/pdf-pages.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import {
    BATES_LIMITS,
    BATES_POSITIONS,
    BATES_TYPEFACES,
    DEFAULT_BATES,
    batesCopyName,
    batesFont,
    batesLabel,
    batesProblems,
    batesRange,
    type BatesSettings,
    type BatesTypeface,
  } from "./bates.ts";
  import { fileMadeDocument, openEditorDocument, type Filed } from "./editor-document.ts";
  import { describeOperationFailure, runPdfOperation } from "./pdf-operations.ts";

  let { file }: { file: MatterFile } = $props();

  const PREVIEW_ZOOM = 0.6;
  /** The engine's own margin from the page edge, in points. */
  const MARGIN_PT = 18;

  type Phase =
    | { readonly kind: "opening" }
    | { readonly kind: "refused"; readonly message: string }
    | { readonly kind: "ready" };

  type Result =
    | { readonly kind: "idle" }
    | { readonly kind: "stamping" }
    | { readonly kind: "done"; readonly filed: Filed; readonly next: number }
    | { readonly kind: "failed"; readonly message: string };

  let phase = $state<Phase>({ kind: "opening" });
  let sizes = $state<readonly PdfPageSize[]>([]);
  let settings = $state<BatesSettings>({ ...DEFAULT_BATES });
  let result = $state<Result>({ kind: "idle" });
  let firstCanvas = $state<HTMLCanvasElement | null>(null);
  let lastCanvas = $state<HTMLCanvasElement | null>(null);

  let source: PdfDocumentSource | null = null;
  let original: ArrayBuffer | null = null;
  let gone = false;

  const problems = $derived(batesProblems(settings));
  const ready = $derived(Object.keys(problems).length === 0);
  const range = $derived(batesRange(settings, sizes.length));
  const lastIndex = $derived(Math.max(0, sizes.length - 1));
  const typefaceClass: Record<BatesTypeface, string> = {
    sans: "font-sans",
    serif: "font-display",
    mono: "font-mono",
  };

  async function paint(canvas: HTMLCanvasElement | null, index: number): Promise<void> {
    const engine = source;
    if (engine === null || canvas === null) return;
    const outcome = await engine.render(index, renderDpiFor(PREVIEW_ZOOM, window.devicePixelRatio));
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
      "This document has a password. Unlock it in the File Workbench, save the unlocked copy, and number that.",
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
    void paint(firstCanvas, 0);
  });
  $effect(() => {
    if (phase.kind !== "ready" || lastIndex === 0) return;
    void paint(lastCanvas, lastIndex);
  });

  function update(change: Partial<BatesSettings>): void {
    settings = { ...settings, ...change };
    if (result.kind !== "stamping") result = { kind: "idle" };
  }

  function whole(value: string, fallback: number): number {
    const parsed = Number(value);
    return value.trim() === "" || !Number.isFinite(parsed) ? fallback : parsed;
  }

  /** Where the label sits over a preview page, in the same terms the engine places it. */
  function labelStyle(size: PdfPageSize): string {
    const scale = pageDisplaySize(size, PREVIEW_ZOOM).width / size.widthPt;
    const margin = MARGIN_PT * scale;
    const vertical = settings.position.startsWith("top") ? `top: ${margin}px` : `bottom: ${margin}px`;
    const horizontal = settings.position.endsWith("Left")
      ? `left: ${margin}px`
      : settings.position.endsWith("Right")
        ? `right: ${margin}px`
        : "left: 50%; transform: translateX(-50%)";
    return `${vertical}; ${horizontal}; font-size: ${settings.sizePt * scale}px; line-height: 1`;
  }

  async function stamp(): Promise<void> {
    if (original === null || !ready || result.kind === "stamping") return;
    result = { kind: "stamping" };
    const reply = await runPdfOperation(original.slice(0), {
      kind: "bates",
      options: {
        prefix: settings.prefix,
        suffix: settings.suffix,
        startNumber: settings.startNumber,
        padding: settings.digits,
        position: settings.position,
        font: batesFont(settings.typeface),
        fontSizePt: settings.sizePt,
        marginPt: MARGIN_PT,
      },
    });
    if (gone) return;
    const made = reply.kind === "done" ? reply.documents[0] : undefined;
    if (reply.kind === "failed" || made === undefined) {
      result = {
        kind: "failed",
        message:
          reply.kind === "failed"
            ? describeOperationFailure(reply.reason, reply.message)
            : describeOperationFailure("refused", ""),
      };
      return;
    }
    const filed = await fileMadeDocument(file, made, batesCopyName(file.name, range.first, range.last));
    if (gone) return;
    result = { kind: "done", filed, next: range.next };
  }
</script>

{#snippet preview(size: PdfPageSize, index: number, label: string)}
  {@const box = pageDisplaySize(size, PREVIEW_ZOOM)}
  <figure class="flex flex-none flex-col items-center gap-8">
    <div class="relative border border-border-default bg-surface-raised" style="width: {box.width}px; height: {box.height}px">
      {#if index === 0}
        <canvas bind:this={firstCanvas} class="block h-full w-full"></canvas>
      {:else}
        <canvas bind:this={lastCanvas} class="block h-full w-full"></canvas>
      {/if}
      <span
        class="absolute font-semibold whitespace-nowrap text-text-default {typefaceClass[settings.typeface]}"
        style={labelStyle(size)}
      >
        {label}
      </span>
    </div>
    <figcaption class="text-xs text-text-muted">Page {index + 1}</figcaption>
  </figure>
{/snippet}

{#if phase.kind === "opening"}
  <p class="p-24 text-sm text-text-muted" role="status">Reading the document</p>
{:else if phase.kind === "refused"}
  <div class="p-24">
    <Alert.Root variant="warning">
      <Alert.Title>This Document Can't Be Numbered Here</Alert.Title>
      <Alert.Description>{phase.message}</Alert.Description>
    </Alert.Root>
  </div>
{:else}
  <div class="flex min-h-0 flex-1">
    <aside aria-label="Bates numbering" class="mc-scrollbar flex min-h-0 w-352 shrink-0 flex-col gap-16 overflow-auto border-e border-border-default bg-surface-default p-16">
      <FieldRow columns={2}>
        <LabelledField label="Prefix" error={problems.prefix}>
          {#snippet children({ props })}
            <Input {...props} value={settings.prefix} placeholder="SMITH-" oninput={(event) => update({ prefix: event.currentTarget.value })} />
          {/snippet}
        </LabelledField>
        <LabelledField label="Suffix" error={problems.suffix}>
          {#snippet children({ props })}
            <Input {...props} value={settings.suffix} oninput={(event) => update({ suffix: event.currentTarget.value })} />
          {/snippet}
        </LabelledField>
      </FieldRow>
      <FieldRow columns={2}>
        <LabelledField label="First Number" error={problems.startNumber}>
          {#snippet children({ props })}
            <Input
              {...props}
              type="number"
              min="0"
              class="tabular-nums"
              value={String(settings.startNumber)}
              oninput={(event) => update({ startNumber: whole(event.currentTarget.value, settings.startNumber) })}
            />
          {/snippet}
        </LabelledField>
        <LabelledField label="Digits" hint="Padded with zeros" error={problems.digits}>
          {#snippet children({ props })}
            <Input
              {...props}
              type="number"
              min={String(BATES_LIMITS.digits.min)}
              max={String(BATES_LIMITS.digits.max)}
              class="tabular-nums"
              value={String(settings.digits)}
              oninput={(event) => update({ digits: whole(event.currentTarget.value, settings.digits) })}
            />
          {/snippet}
        </LabelledField>
      </FieldRow>
      <LabelledField label="Position">
        {#snippet children({ props })}
          <Select.Root
            type="single"
            items={[...BATES_POSITIONS]}
            allowDeselect={false}
            bind:value={() => settings.position, (picked) => update({ position: (picked || settings.position) as BatesSettings["position"] })}
          >
            <Select.Trigger id={props.id} aria-describedby={props["aria-describedby"]}>
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {#each BATES_POSITIONS as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        {/snippet}
      </LabelledField>
      <FieldRow columns={2}>
        <LabelledField label="Typeface">
          {#snippet children({ props })}
            <Select.Root
              type="single"
              items={[...BATES_TYPEFACES]}
              allowDeselect={false}
              bind:value={() => settings.typeface, (picked) => update({ typeface: (picked || settings.typeface) as BatesTypeface })}
            >
              <Select.Trigger id={props.id} aria-describedby={props["aria-describedby"]}>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each BATES_TYPEFACES as item (item.value)}
                  <Select.Item value={item.value} label={item.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          {/snippet}
        </LabelledField>
        <LabelledField label="Size (pt)" error={problems.sizePt}>
          {#snippet children({ props })}
            <Input
              {...props}
              type="number"
              min={String(BATES_LIMITS.sizePt.min)}
              max={String(BATES_LIMITS.sizePt.max)}
              class="tabular-nums"
              value={String(settings.sizePt)}
              oninput={(event) => update({ sizePt: whole(event.currentTarget.value, settings.sizePt) })}
            />
          {/snippet}
        </LabelledField>
      </FieldRow>

      <p class="text-sm">
        {sizes.length === 1 ? "1 page" : `${sizes.length} pages`}, numbered
        <span class="font-semibold tabular-nums">{range.first}</span>
        {#if sizes.length > 1}to <span class="font-semibold tabular-nums">{range.last}</span>{/if}.
      </p>

      <div class="mt-auto flex flex-col gap-8">
        {#if result.kind === "done" && result.filed.kind === "filed"}
          <Alert.Root variant="success">
            <Alert.Title>Saved {result.filed.name}</Alert.Title>
            <Alert.Description>
              The original is unchanged. The next production from this matter starts at
              <span class="tabular-nums">{batesLabel(settings, result.next)}</span>.
            </Alert.Description>
            <Button variant="secondary" size="sm" class="self-start" href={viewerHref(result.filed.fileId)}>Open the Numbered Copy</Button>
          </Alert.Root>
        {:else if result.kind === "done" && result.filed.kind === "notFiled"}
          <Alert.Root variant="warning">
            <Alert.Title>Not Filed</Alert.Title>
            <Alert.Description>The numbered copy was made but couldn't be saved to the matter. Download it now; nothing was saved.</Alert.Description>
            <Button variant="secondary" size="sm" class="self-start" href={result.filed.url} download={result.filed.name}>Download</Button>
          </Alert.Root>
        {:else if result.kind === "failed"}
          <Alert.Root variant="danger">
            <Alert.Title>Nothing Was Numbered</Alert.Title>
            <Alert.Description>{result.message}</Alert.Description>
          </Alert.Root>
        {/if}
        <Button disabled={!ready || result.kind === "stamping"} onclick={stamp}>
          <Hash class="size-16" aria-hidden="true" />
          {result.kind === "stamping" ? "Numbering" : "Number the Pages"}
        </Button>
        <p class="text-center text-xs text-text-muted">Saves a numbered copy beside the original, which stays as it is.</p>
      </div>
    </aside>

    <div class="mc-scrollbar flex min-h-0 min-w-0 flex-1 items-start justify-center gap-24 overflow-auto bg-surface-sunken p-24">
      {#if sizes[0] !== undefined}
        {@render preview(sizes[0], 0, range.first)}
      {/if}
      {#if lastIndex > 0 && sizes[lastIndex] !== undefined}
        {@render preview(sizes[lastIndex], lastIndex, range.last)}
      {/if}
    </div>
  </div>
{/if}
