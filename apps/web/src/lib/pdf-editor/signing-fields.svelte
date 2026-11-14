<script lang="ts">
  /*
   * The first step of sending a document for signature: who signs, and where each of them signs.
   * Mockup screen 5.
   *
   * A field is placed by picking a kind in the palette and clicking the page, which drops it at the
   * kind's usual size, or by dragging out a box of any size. Each signer has a colour, and every
   * field on the page wears its signer's colour and initials, so who signs where reads at a glance.
   * Nothing here is saved until the member saves the draft or sends it.
   */
  import ArrowDown from "@lucide/svelte/icons/arrow-down";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import Trash2 from "@lucide/svelte/icons/trash-2";
  import UserPlus from "@lucide/svelte/icons/user-plus";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Checkbox from "@magna-carta/design-system/checkbox";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as Select from "@magna-carta/design-system/select";
  import { PdfDocumentSource, pageDisplaySize, renderDpiFor, type PdfPageSize } from "$lib/documents/pdf-pages.ts";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import { boxBetween, pointsToScreen, screenToPoints, type ScreenRect } from "./redactions.ts";
  import {
    ATTRIBUTIONS,
    FIELD_KINDS,
    fieldAt,
    fieldCounts,
    fieldLabel,
    initialsOf,
    moveSigner,
    toneOf,
    withoutSigner,
    type Attribution,
    type DraftField,
    type FieldKind,
    type PointRect,
    type SigningDraft,
  } from "./signing-draft.ts";

  let {
    draft = $bindable(),
    source,
    pages,
  }: {
    draft: SigningDraft;
    source: PdfDocumentSource;
    pages: readonly PdfPageSize[];
  } = $props();

  const ZOOM_FACTORS: readonly number[] = [0.75, 1, 1.25, 1.5, 2];
  const THUMBNAIL_ZOOM = 0.15;
  /** A drag shorter than this, in pixels, is a click: the field takes its kind's usual size. */
  const DRAG_THRESHOLD_PIXELS = 6;
  /** The smallest box a field may be, in points; the server refuses anything smaller. */
  const MINIMUM_FIELD_POINTS = 8;

  let currentPage = $state(0);
  let zoomIndex = $state(1);
  let kind = $state<FieldKind>("signature");
  let activeSignerKey = $state<string | null>(draft.signers[0]?.key ?? null);
  let selectedKey = $state<string | null>(null);
  let dragStart = $state<{ x: number; y: number } | null>(null);
  let dragBox = $state<ScreenRect | null>(null);
  let newName = $state("");
  let newEmail = $state("");
  let newMember = $state("");
  let pageCanvas = $state<HTMLCanvasElement | null>(null);
  let thumbnailCanvases = $state<(HTMLCanvasElement | null)[]>([]);
  const paintedThumbnails = new Set<number>();
  let gone = false;
  let nextKey = 1;

  const zoom = $derived(ZOOM_FACTORS[zoomIndex] ?? 1);
  const pageSize = $derived(pages[currentPage] ?? null);
  const display = $derived(pageSize === null ? null : pageDisplaySize(pageSize, zoom));
  const toneIndex = $derived(new Map(draft.signers.map((signer, index) => [signer.key, index])));
  const nameOf = $derived(new Map(draft.signers.map((signer) => [signer.key, signer.name])));
  const counts = $derived(fieldCounts(draft));
  const fieldsOnPage = $derived(draft.fields.filter((field) => field.page === currentPage + 1));
  const pagesWithFields = $derived(new Set(draft.fields.map((field) => field.page - 1)));
  const selected = $derived(draft.fields.find((field) => field.key === selectedKey) ?? null);
  const signerItems = $derived(draft.signers.map((signer) => ({ value: signer.key, label: signer.name })));
  const attributionItems = ATTRIBUTIONS.map((one) => ({ value: one.value, label: one.label }));
  const memberItems = $derived(
    firmRoster.active
      .filter((member) => !draft.signers.some((signer) => signer.userId === member.userId))
      .map((member) => ({ value: member.userId, label: member.displayName })),
  );
  const canAddOutside = $derived(newName.trim() !== "" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail.trim()));

  $effect(() => {
    void firmRoster.load(fetch);
    return () => {
      gone = true;
    };
  });

  // The signer being placed for falls back to the first one when theirs is removed.
  $effect(() => {
    if (activeSignerKey === null || !draft.signers.some((signer) => signer.key === activeSignerKey)) {
      activeSignerKey = draft.signers[0]?.key ?? null;
    }
  });

  async function paint(canvas: HTMLCanvasElement | null, index: number, atZoom: number): Promise<void> {
    if (canvas === null) return;
    const outcome = await source.render(index, renderDpiFor(atZoom, window.devicePixelRatio));
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
    void paint(pageCanvas, currentPage, zoom);
  });

  $effect(() => {
    thumbnailCanvases.forEach((canvas, index) => {
      if (canvas === null || paintedThumbnails.has(index)) return;
      paintedThumbnails.add(index);
      void paint(canvas, index, THUMBNAIL_ZOOM);
    });
  });

  function freshKey(prefix: string): string {
    const key = `${prefix}-new-${Date.now().toString(36)}-${nextKey}`;
    nextKey += 1;
    return key;
  }

  function pointIn(event: PointerEvent): { x: number; y: number } {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function asPointRect(rect: PointRect): { x0: number; y0: number; x1: number; y1: number } {
    return { x0: rect[0], y0: rect[1], x1: rect[2], y1: rect[3] };
  }

  function beginPlace(event: PointerEvent): void {
    if (display === null || event.button !== 0 || activeSignerKey === null) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragStart = pointIn(event);
    dragBox = null;
  }

  function continuePlace(event: PointerEvent): void {
    if (dragStart === null || display === null) return;
    dragBox = boxBetween(dragStart, pointIn(event), display.width, display.height);
  }

  function endPlace(event: PointerEvent): void {
    const start = dragStart;
    const box = dragBox;
    dragStart = null;
    dragBox = null;
    if (start === null || pageSize === null || activeSignerKey === null) return;
    let rect: PointRect;
    if (box !== null && (box.width >= DRAG_THRESHOLD_PIXELS || box.height >= DRAG_THRESHOLD_PIXELS)) {
      const drawn = screenToPoints(box, pageSize, zoom);
      if (drawn.x1 - drawn.x0 < MINIMUM_FIELD_POINTS || drawn.y1 - drawn.y0 < MINIMUM_FIELD_POINTS) return;
      rect = [drawn.x0, drawn.y0, drawn.x1, drawn.y1];
    } else {
      const at = event.type === "pointercancel" ? start : pointIn(event);
      const spot = screenToPoints({ left: at.x, top: at.y, width: 0, height: 0 }, pageSize, zoom);
      rect = fieldAt(kind, { x: spot.x0, y: spot.y1 }, pageSize);
    }
    const key = freshKey("field");
    const field: DraftField = { key, signerKey: activeSignerKey, kind, page: currentPage + 1, rect, required: kind !== "checkbox" };
    draft = { ...draft, fields: [...draft.fields, field] };
    selectedKey = key;
  }

  function updateSelected(change: Partial<Pick<DraftField, "signerKey" | "kind" | "required">>): void {
    if (selectedKey === null) return;
    draft = {
      ...draft,
      fields: draft.fields.map((field) => (field.key === selectedKey ? { ...field, ...change } : field)),
    };
  }

  function removeSelected(): void {
    draft = { ...draft, fields: draft.fields.filter((field) => field.key !== selectedKey) };
    selectedKey = null;
  }

  function addOutsideSigner(): void {
    if (!canAddOutside) return;
    const key = freshKey("signer");
    draft = {
      ...draft,
      signers: [...draft.signers, { key, name: newName.trim(), email: newEmail.trim(), attribution: "access-code" }],
    };
    activeSignerKey = key;
    newName = "";
    newEmail = "";
  }

  function addMember(userId: string): void {
    const member = firmRoster.active.find((one) => one.userId === userId);
    if (member === undefined) return;
    const key = freshKey("signer");
    draft = {
      ...draft,
      signers: [
        ...draft.signers,
        { key, name: member.displayName, email: "", attribution: "firm-authenticated", userId: member.userId },
      ],
    };
    activeSignerKey = key;
    newMember = "";
  }

  function setAttribution(key: string, attribution: Attribution): void {
    draft = {
      ...draft,
      signers: draft.signers.map((signer) => (signer.key === key ? { ...signer, attribution } : signer)),
    };
  }

  function stepZoom(by: -1 | 1): void {
    zoomIndex = Math.min(ZOOM_FACTORS.length - 1, Math.max(0, zoomIndex + by));
  }

  function boxStyle(box: ScreenRect): string {
    return `left: ${box.left}px; top: ${box.top}px; width: ${box.width}px; height: ${box.height}px`;
  }
</script>

<div class="flex min-h-0 flex-1">
  <nav aria-label="Pages" class="mc-scrollbar flex min-h-0 w-128 shrink-0 flex-col items-center gap-12 overflow-auto border-e border-border-default p-12">
    {#each pages as size, index (index)}
      {@const thumb = pageDisplaySize(size, THUMBNAIL_ZOOM * 2.2)}
      <button
        type="button"
        class="flex flex-col items-center gap-4 rounded-sm"
        aria-current={index === currentPage ? "page" : undefined}
        aria-label="Page {index + 1}{pagesWithFields.has(index) ? ', has fields' : ''}"
        onclick={() => (currentPage = index)}
      >
        <span
          class="block border bg-surface-raised {index === currentPage ? 'border-accent-default ring-2 ring-accent-default' : 'border-border-default'}"
          style="width: {thumb.width}px; height: {thumb.height}px"
        >
          <canvas bind:this={thumbnailCanvases[index]} class="block h-full w-full"></canvas>
        </span>
        <span class="text-xs tabular-nums {pagesWithFields.has(index) ? 'font-semibold text-text-default' : 'text-text-muted'}">
          {index + 1}
        </span>
      </button>
    {/each}
  </nav>

  <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-sunken">
    <div class="flex flex-none flex-wrap items-center gap-8 border-b border-border-default bg-surface-default px-12 py-8">
      <span class="flex flex-wrap gap-4" role="group" aria-label="Field to place">
        {#each FIELD_KINDS as one (one.kind)}
          <Button
            variant={kind === one.kind ? "primary" : "ghost"}
            size="sm"
            aria-pressed={kind === one.kind}
            onclick={() => (kind = one.kind)}
          >
            {one.label}
          </Button>
        {/each}
      </span>
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
      {#if display !== null && pageSize !== null}
        <div
          class="relative flex-none touch-none select-none border border-border-default bg-surface-raised {activeSignerKey === null ? 'cursor-not-allowed' : 'cursor-crosshair'}"
          style="width: {display.width}px; height: {display.height}px"
          role="application"
          aria-label="Page {currentPage + 1}. Click to place a {fieldLabel(kind)} field, or drag to size one."
          onpointerdown={beginPlace}
          onpointermove={continuePlace}
          onpointerup={endPlace}
          onpointercancel={endPlace}
        >
          <canvas bind:this={pageCanvas} class="pointer-events-none block h-full w-full"></canvas>
          {#each fieldsOnPage as field (field.key)}
            {@const box = pointsToScreen(asPointRect(field.rect), pageSize, zoom)}
            {@const tone = toneOf(toneIndex.get(field.signerKey) ?? 0)}
            <button
              type="button"
              class="absolute flex items-center justify-center overflow-hidden border-2 text-xs {tone.box} {selectedKey === field.key ? 'ring-2 ring-accent-default' : ''}"
              style={boxStyle(box)}
              aria-label="{fieldLabel(field.kind)} for {nameOf.get(field.signerKey) ?? 'a signer'}"
              onpointerdown={(event) => event.stopPropagation()}
              onpointerup={(event) => event.stopPropagation()}
              onclick={() => (selectedKey = field.key)}
            >
              <span class="absolute -top-px start-0 rounded-xs px-4 font-semibold {tone.chip}">
                {initialsOf(nameOf.get(field.signerKey) ?? "")}
              </span>
              {#if box.width > 64}<span class="truncate px-4 text-text-default">{fieldLabel(field.kind)}</span>{/if}
            </button>
          {/each}
          {#if dragBox !== null && activeSignerKey !== null}
            <div class="pointer-events-none absolute border-2 {toneOf(toneIndex.get(activeSignerKey) ?? 0).box}" style={boxStyle(dragBox)}></div>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <aside aria-label="Signers and fields" class="mc-scrollbar flex min-h-0 w-352 shrink-0 flex-col gap-16 overflow-auto border-s border-border-default bg-surface-default p-16">
    <section class="flex flex-col gap-8" aria-labelledby="signing-signers">
      <h2 id="signing-signers" class="text-sm font-semibold">Signers</h2>
      {#each draft.signers as signer, index (signer.key)}
        {@const tone = toneOf(index)}
        <div
          class="flex flex-col gap-8 rounded-md border p-8 {activeSignerKey === signer.key ? 'border-accent-default' : 'border-border-default'}"
        >
          <div class="flex items-center gap-8">
            <span class="flex size-24 flex-none items-center justify-center rounded-full text-xs font-semibold {tone.chip}">
              {initialsOf(signer.name)}
            </span>
            <button
              type="button"
              class="flex min-w-0 flex-1 flex-col text-start"
              aria-pressed={activeSignerKey === signer.key}
              aria-label="Place fields for {signer.name}"
              onclick={() => (activeSignerKey = signer.key)}
            >
              <span class="truncate text-sm">{signer.name}</span>
              <span class="truncate text-xs text-text-muted">
                {signer.attribution === "firm-authenticated" ? "Firm member" : signer.email}
                · {counts.get(signer.key) ?? 0} {counts.get(signer.key) === 1 ? "field" : "fields"}
              </span>
            </button>
            <Button variant="ghost" size="icon-sm" aria-label="Move {signer.name} earlier" disabled={index === 0} onclick={() => (draft = moveSigner(draft, signer.key, -1))}>
              <ArrowUp class="size-16" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Move {signer.name} later" disabled={index === draft.signers.length - 1} onclick={() => (draft = moveSigner(draft, signer.key, 1))}>
              <ArrowDown class="size-16" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Remove {signer.name} and their fields" onclick={() => (draft = withoutSigner(draft, signer.key))}>
              <Trash2 class="size-16" aria-hidden="true" />
            </Button>
          </div>
          {#if signer.attribution !== "firm-authenticated"}
            <Select.Root
              type="single"
              items={attributionItems.filter((item) => item.value !== "firm-authenticated")}
              allowDeselect={false}
              bind:value={() => signer.attribution, (picked) => setAttribution(signer.key, (picked || signer.attribution) as Attribution)}
            >
              <Select.Trigger aria-label="How {signer.name} proves who they are">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each ATTRIBUTIONS.filter((one) => one.value !== "firm-authenticated") as one (one.value)}
                  <Select.Item value={one.value} label={one.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          {/if}
        </div>
      {:else}
        <p class="text-sm text-text-muted">Add the people who sign, then place their fields on the pages.</p>
      {/each}

      <div class="flex flex-col gap-8 border-t border-border-default pt-8">
        <LabelledField label="Name">
          {#snippet children({ props })}
            <Input {...props} bind:value={newName} maxlength={200} autocomplete="off" />
          {/snippet}
        </LabelledField>
        <LabelledField label="Email">
          {#snippet children({ props })}
            <Input {...props} type="email" bind:value={newEmail} maxlength={320} autocomplete="off" />
          {/snippet}
        </LabelledField>
        <Button variant="secondary" size="sm" class="self-start" disabled={!canAddOutside} onclick={addOutsideSigner}>
          <UserPlus class="size-16" aria-hidden="true" />
          Add Signer
        </Button>
        {#if memberItems.length > 0}
          <Select.Root type="single" items={memberItems} bind:value={() => newMember, (picked) => addMember(picked)}>
            <Select.Trigger aria-label="Add a firm member as a signer">
              <Select.Value placeholder={placeholderOf("Firm Member")} />
            </Select.Trigger>
            <Select.Content>
              {#each memberItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        {:else if firmRoster.failure !== null}
          <p class="text-xs text-text-muted">{firmRoster.failure}</p>
        {/if}
      </div>
    </section>

    {#if selected !== null}
      <section class="flex flex-col gap-8 border-t border-border-default pt-16" aria-labelledby="signing-selected-field">
        <h2 id="signing-selected-field" class="text-sm font-semibold">Selected Field</h2>
        <p class="text-xs text-text-muted">Page {selected.page}</p>
        <LabelledField label="Kind">
          {#snippet children({ props })}
            <Select.Root
              type="single"
              items={FIELD_KINDS.map((one) => ({ value: one.kind, label: one.label }))}
              allowDeselect={false}
              bind:value={() => selected.kind, (picked) => updateSelected({ kind: (picked || selected.kind) as FieldKind })}
            >
              <Select.Trigger {...props}>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each FIELD_KINDS as one (one.kind)}
                  <Select.Item value={one.kind} label={one.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          {/snippet}
        </LabelledField>
        <LabelledField label="Signer">
          {#snippet children({ props })}
            <Select.Root
              type="single"
              items={signerItems}
              allowDeselect={false}
              bind:value={() => selected.signerKey, (picked) => updateSelected({ signerKey: picked || selected.signerKey })}
            >
              <Select.Trigger {...props}>
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each signerItems as item (item.value)}
                  <Select.Item value={item.value} label={item.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          {/snippet}
        </LabelledField>
        <div class="flex items-center gap-8">
          <Checkbox id="signing-field-required" checked={selected.required} onCheckedChange={(checked) => updateSelected({ required: checked })} />
          <Label for="signing-field-required">Required</Label>
        </div>
        <Button variant="ghost" size="sm" class="self-start" onclick={removeSelected}>
          <Trash2 class="size-16" aria-hidden="true" />
          Remove Field
        </Button>
      </section>
    {:else if draft.signers.length > 0 && draft.fields.length === 0}
      <Alert.Root variant="info">
        <Alert.Title>Place the Fields</Alert.Title>
        <Alert.Description>
          Pick a signer, pick a field above the page, then click where it goes. Every signer needs at least one signature.
        </Alert.Description>
      </Alert.Root>
    {/if}
  </aside>
</div>
