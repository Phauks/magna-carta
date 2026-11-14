<script lang="ts">
  /*
   * The PDF Editor's Watermark tab: set up a word or a logo, see it on a page, and save a marked
   * copy beside the original.
   *
   * The preview draws the mark over the page in the browser; it shows where the mark goes and how
   * strongly it reads, not the engine's own output, which uses a standard PDF font. The marked
   * copy is checked by opening it.
   */
  import { onMount } from "svelte";
  import Stamp from "@lucide/svelte/icons/stamp";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import FieldRow from "@magna-carta/design-system/field-row";
  import FileInput from "@magna-carta/design-system/file-input";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Select from "@magna-carta/design-system/select";
  import Slider from "@magna-carta/design-system/slider";
  import { viewerHref } from "$lib/documents/editable-documents.ts";
  import { PdfDocumentSource, pageDisplaySize, renderDpiFor, type PdfPageSize } from "$lib/documents/pdf-pages.ts";
  import type { MatterFile } from "$lib/file-manager/matter-file-api.ts";
  import { BATES_TYPEFACES, type BatesTypeface } from "./bates.ts";
  import { fileMadeDocument, openEditorDocument, type Filed } from "./editor-document.ts";
  import { describeOperationFailure, runPdfOperation } from "./pdf-operations.ts";
  import {
    DEFAULT_WATERMARK,
    WATERMARK_COLOURS,
    WATERMARK_LIMITS,
    WATERMARK_PRESETS,
    parsePageList,
    watermarkOptions,
    watermarkProblems,
    watermarkedCopyName,
    type WatermarkColour,
    type WatermarkSettings,
  } from "./watermark.ts";

  let { file }: { file: MatterFile } = $props();

  const PREVIEW_ZOOM = 0.7;
  const OTHER = "other";
  /** A logo larger than this is refused before it is read; a watermark does not need more. */
  const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

  type Phase =
    | { readonly kind: "opening" }
    | { readonly kind: "refused"; readonly message: string }
    | { readonly kind: "ready" };

  type Result =
    | { readonly kind: "idle" }
    | { readonly kind: "marking" }
    | { readonly kind: "done"; readonly filed: Filed }
    | { readonly kind: "failed"; readonly message: string };

  let phase = $state<Phase>({ kind: "opening" });
  let sizes = $state<readonly PdfPageSize[]>([]);
  let settings = $state<WatermarkSettings>({ ...DEFAULT_WATERMARK });
  let preset = $state<string>(DEFAULT_WATERMARK.text);
  let image = $state<{ bytes: Uint8Array; url: string; name: string } | null>(null);
  let imageProblem = $state<string | null>(null);
  let result = $state<Result>({ kind: "idle" });
  let canvas = $state<HTMLCanvasElement | null>(null);

  let source: PdfDocumentSource | null = null;
  let original: ArrayBuffer | null = null;
  let gone = false;

  const problems = $derived(watermarkProblems(settings, sizes.length, image !== null));
  const ready = $derived(Object.keys(problems).length === 0 && imageProblem === null);
  const chosenPages = $derived(parsePageList(settings.pages, sizes.length));
  /** The page the preview shows: the first one that will be marked. */
  const previewIndex = $derived("pages" in chosenPages && chosenPages.pages !== null ? (chosenPages.pages[0] ?? 0) : 0);
  const markedCount = $derived(
    "pages" in chosenPages && chosenPages.pages !== null ? chosenPages.pages.length : sizes.length,
  );
  const colour = $derived(WATERMARK_COLOURS.find((one) => one.value === settings.colour) ?? WATERMARK_COLOURS[0]);
  const presetItems = [
    ...WATERMARK_PRESETS.map((words) => ({ value: words, label: words })),
    { value: OTHER, label: "Other" },
  ];
  const colourItems = WATERMARK_COLOURS.map((one) => ({ value: one.value, label: one.label }));
  const rotationItems = [
    { value: "45", label: "Diagonal" },
    { value: "0", label: "Across" },
    { value: "90", label: "Down the Side" },
  ];
  const typefaceClass: Record<BatesTypeface, string> = {
    sans: "font-sans",
    serif: "font-display",
    mono: "font-mono",
  };

  async function paint(target: HTMLCanvasElement | null, index: number): Promise<void> {
    const engine = source;
    if (engine === null || target === null) return;
    const outcome = await engine.render(index, renderDpiFor(PREVIEW_ZOOM, window.devicePixelRatio));
    if (gone || "failure" in outcome) return;
    const context = target.getContext("2d");
    if (context === null) return;
    target.width = outcome.page.width;
    target.height = outcome.page.height;
    context.putImageData(
      new ImageData(new Uint8ClampedArray(outcome.page.data), outcome.page.width, outcome.page.height),
      0,
      0,
    );
  }

  async function open(): Promise<void> {
    const opened = await openEditorDocument(
      file,
      "This document has a password. Unlock it in the File Workbench, save the unlocked copy, and mark that.",
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
      if (image !== null) URL.revokeObjectURL(image.url);
    };
  });

  $effect(() => {
    if (phase.kind !== "ready") return;
    void paint(canvas, previewIndex);
  });

  function update(change: Partial<WatermarkSettings>): void {
    settings = { ...settings, ...change };
    if (result.kind !== "marking") result = { kind: "idle" };
  }

  function choosePreset(value: string): void {
    preset = value;
    if (value !== OTHER) update({ text: value });
  }

  async function chooseImage(event: Event & { currentTarget: HTMLInputElement }): Promise<void> {
    const picked = event.currentTarget.files?.[0];
    if (image !== null) URL.revokeObjectURL(image.url);
    image = null;
    imageProblem = null;
    if (picked === undefined) return;
    if (picked.type !== "image/png" && picked.type !== "image/jpeg") {
      imageProblem = "Choose a PNG or JPEG image.";
      return;
    }
    if (picked.size > IMAGE_MAX_BYTES) {
      imageProblem = "Choose an image under 5 MB.";
      return;
    }
    const bytes = new Uint8Array(await picked.arrayBuffer());
    image = { bytes, url: URL.createObjectURL(picked), name: picked.name };
    result = { kind: "idle" };
  }

  function number(value: string, fallback: number): number {
    const parsed = Number(value);
    return value.trim() === "" || !Number.isFinite(parsed) ? fallback : parsed;
  }

  /** The preview's copies of the mark: one in the middle, or a three-by-three tiling. */
  const tiles = $derived(
    settings.placement === "center"
      ? [{ left: 50, top: 50 }]
      : [17, 50, 83].flatMap((top) => [17, 50, 83].map((left) => ({ left, top }))),
  );

  function markStyle(size: PdfPageSize, at: { left: number; top: number }): string {
    const scale = pageDisplaySize(size, PREVIEW_ZOOM).width / size.widthPt;
    const placed = `left: ${at.left}%; top: ${at.top}%; opacity: ${settings.opacity}; transform: translate(-50%, -50%) rotate(${settings.rotation}deg)`;
    if (settings.kind === "image") {
      const width = pageDisplaySize(size, PREVIEW_ZOOM).width * settings.imageScale;
      return `${placed}; width: ${width}px`;
    }
    return `${placed}; font-size: ${settings.sizePt * scale}px; line-height: 1`;
  }

  async function mark(): Promise<void> {
    if (original === null || !ready || result.kind === "marking") return;
    result = { kind: "marking" };
    const reply = await runPdfOperation(original.slice(0), {
      kind: "watermark",
      options: watermarkOptions(settings, sizes.length, image?.bytes ?? null),
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
    const filed = await fileMadeDocument(file, made, watermarkedCopyName(file.name, settings));
    if (gone) return;
    result = { kind: "done", filed };
  }
</script>

{#if phase.kind === "opening"}
  <p class="p-24 text-sm text-text-muted" role="status">Reading the document</p>
{:else if phase.kind === "refused"}
  <div class="p-24">
    <Alert.Root variant="warning">
      <Alert.Title>This Document Can't Be Marked Here</Alert.Title>
      <Alert.Description>{phase.message}</Alert.Description>
    </Alert.Root>
  </div>
{:else}
  <div class="flex min-h-0 flex-1">
    <aside aria-label="Watermark" class="mc-scrollbar flex min-h-0 w-352 shrink-0 flex-col gap-16 overflow-auto border-e border-border-default bg-surface-default p-16">
      <div class="flex flex-col gap-8">
        <Label id="watermark-kind-label">Mark</Label>
        <RadioGroup.Root
          aria-labelledby="watermark-kind-label"
          value={settings.kind}
          onValueChange={(value) => update({ kind: value === "image" ? "image" : "text" })}
          class="flex gap-24"
        >
          <div class="flex items-center gap-8">
            <RadioGroup.Item value="text" id="watermark-kind-text" />
            <Label for="watermark-kind-text">Words</Label>
          </div>
          <div class="flex items-center gap-8">
            <RadioGroup.Item value="image" id="watermark-kind-image" />
            <Label for="watermark-kind-image">Image</Label>
          </div>
        </RadioGroup.Root>
      </div>

      {#if settings.kind === "text"}
        <LabelledField label="Words">
          {#snippet children({ props })}
            <Select.Root type="single" items={presetItems} allowDeselect={false} bind:value={() => preset, (picked) => choosePreset(picked || preset)}>
              <Select.Trigger id={props.id}>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each presetItems as item (item.value)}
                  <Select.Item value={item.value} label={item.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          {/snippet}
        </LabelledField>
        {#if preset === OTHER}
          <LabelledField label="Your Words" error={problems.text}>
            {#snippet children({ props })}
              <Input {...props} value={settings.text} maxlength={WATERMARK_LIMITS.textLength} oninput={(event) => update({ text: event.currentTarget.value })} />
            {/snippet}
          </LabelledField>
        {/if}
        <FieldRow columns={2}>
          <LabelledField label="Typeface">
            {#snippet children({ props })}
              <Select.Root
                type="single"
                items={[...BATES_TYPEFACES]}
                allowDeselect={false}
                bind:value={() => settings.typeface, (picked) => update({ typeface: (picked || settings.typeface) as BatesTypeface })}
              >
                <Select.Trigger id={props.id}>
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
                min={String(WATERMARK_LIMITS.sizePt.min)}
                max={String(WATERMARK_LIMITS.sizePt.max)}
                class="tabular-nums"
                value={String(settings.sizePt)}
                oninput={(event) => update({ sizePt: number(event.currentTarget.value, settings.sizePt) })}
              />
            {/snippet}
          </LabelledField>
        </FieldRow>
        <LabelledField label="Colour">
          {#snippet children({ props })}
            <Select.Root
              type="single"
              items={colourItems}
              allowDeselect={false}
              bind:value={() => settings.colour, (picked) => update({ colour: (picked || settings.colour) as WatermarkColour })}
            >
              <Select.Trigger id={props.id}>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each colourItems as item (item.value)}
                  <Select.Item value={item.value} label={item.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          {/snippet}
        </LabelledField>
      {:else}
        <LabelledField label="Image" hint="PNG or JPEG, such as the firm's logo" error={imageProblem ?? problems.kind}>
          {#snippet children({ props })}
            <FileInput {...props} accept="image/png,image/jpeg" onchange={chooseImage} />
          {/snippet}
        </LabelledField>
        <div class="flex flex-col gap-8">
          <Label>Width: {Math.round(settings.imageScale * 100)}% of the page</Label>
          <Slider
            label="Image width"
            min={WATERMARK_LIMITS.imageScale.min}
            max={WATERMARK_LIMITS.imageScale.max}
            step={0.05}
            value={settings.imageScale}
            onValueChange={(value) => update({ imageScale: value })}
          />
        </div>
      {/if}

      <div class="flex flex-col gap-8">
        <Label>Strength: {Math.round(settings.opacity * 100)}%</Label>
        <Slider
          label="Watermark strength"
          min={WATERMARK_LIMITS.opacity.min}
          max={WATERMARK_LIMITS.opacity.max}
          step={0.05}
          value={settings.opacity}
          onValueChange={(value) => update({ opacity: value })}
        />
      </div>
      <FieldRow columns={2}>
        <LabelledField label="Angle">
          {#snippet children({ props })}
            <Select.Root
              type="single"
              items={rotationItems}
              allowDeselect={false}
              bind:value={() => String(settings.rotation), (picked) => update({ rotation: Number(picked || settings.rotation) as WatermarkSettings["rotation"] })}
            >
              <Select.Trigger id={props.id}>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each rotationItems as item (item.value)}
                  <Select.Item value={item.value} label={item.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          {/snippet}
        </LabelledField>
        <LabelledField label="Layout">
          {#snippet children({ props })}
            <Select.Root
              type="single"
              items={[
                { value: "center", label: "Once, Centred" },
                { value: "tiled", label: "Repeated" },
              ]}
              allowDeselect={false}
              bind:value={() => settings.placement, (picked) => update({ placement: picked === "tiled" ? "tiled" : "center" })}
            >
              <Select.Trigger id={props.id}>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                <Select.Item value="center" label="Once, Centred" />
                <Select.Item value="tiled" label="Repeated" />
              </Select.Content>
            </Select.Root>
          {/snippet}
        </LabelledField>
      </FieldRow>
      <LabelledField label="Pages" hint="Leave empty for all pages, or write pages like 1-3, 7" error={problems.pages}>
        {#snippet children({ props })}
          <Input {...props} value={settings.pages} placeholder="All pages" oninput={(event) => update({ pages: event.currentTarget.value })} />
        {/snippet}
      </LabelledField>

      <div class="mt-auto flex flex-col gap-8">
        {#if result.kind === "done" && result.filed.kind === "filed"}
          <Alert.Root variant="success">
            <Alert.Title>Saved {result.filed.name}</Alert.Title>
            <Alert.Description>The original is unchanged.</Alert.Description>
            <Button variant="secondary" size="sm" class="self-start" href={viewerHref(result.filed.fileId)}>Open the Marked Copy</Button>
          </Alert.Root>
        {:else if result.kind === "done" && result.filed.kind === "notFiled"}
          <Alert.Root variant="warning">
            <Alert.Title>Not Filed</Alert.Title>
            <Alert.Description>The marked copy was made but couldn't be saved to the matter. Download it now; nothing was saved.</Alert.Description>
            <Button variant="secondary" size="sm" class="self-start" href={result.filed.url} download={result.filed.name}>Download</Button>
          </Alert.Root>
        {:else if result.kind === "failed"}
          <Alert.Root variant="danger">
            <Alert.Title>Nothing Was Marked</Alert.Title>
            <Alert.Description>{result.message}</Alert.Description>
          </Alert.Root>
        {/if}
        <Button disabled={!ready || result.kind === "marking"} onclick={mark}>
          <Stamp class="size-16" aria-hidden="true" />
          {result.kind === "marking" ? "Marking" : markedCount === 1 ? "Mark 1 Page" : `Mark ${markedCount} Pages`}
        </Button>
        <p class="text-center text-xs text-text-muted">Saves a marked copy beside the original, which stays as it is.</p>
      </div>
    </aside>

    <div class="mc-scrollbar flex min-h-0 min-w-0 flex-1 items-start justify-center overflow-auto bg-surface-sunken p-24">
      {#if sizes[previewIndex] !== undefined}
        {@const size = sizes[previewIndex] as PdfPageSize}
        {@const box = pageDisplaySize(size, PREVIEW_ZOOM)}
        <figure class="flex flex-none flex-col items-center gap-8">
          <div class="relative overflow-hidden border border-border-default bg-surface-raised" style="width: {box.width}px; height: {box.height}px">
            <canvas bind:this={canvas} class="block h-full w-full"></canvas>
            {#each tiles as at (`${at.left}-${at.top}`)}
              {#if settings.kind === "image"}
                {#if image !== null}
                  <img src={image.url} alt="" class="pointer-events-none absolute" style={markStyle(size, at)} />
                {/if}
              {:else}
                <span
                  class="pointer-events-none absolute font-bold whitespace-nowrap {colour.previewClass} {typefaceClass[settings.typeface]}"
                  style={markStyle(size, at)}
                >
                  {settings.text}
                </span>
              {/if}
            {/each}
          </div>
          <figcaption class="text-xs text-text-muted">Page {previewIndex + 1}</figcaption>
        </figure>
      {/if}
    </div>
  </div>
{/if}
