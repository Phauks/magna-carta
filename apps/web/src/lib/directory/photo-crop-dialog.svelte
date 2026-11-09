<script lang="ts">
  /*
   * Choosing a record's picture and cutting it to a square.
   *
   * The picture is drawn in a square frame with a circle over it, because the circle is how the
   * picture is seen everywhere else: what sits inside it here is what a reader will see beside the
   * name. Dragging moves the picture, the arrow keys do the same from the keyboard, and Zoom In and
   * Zoom Out enlarge it about the centre. The arithmetic lives in photo-crop.ts.
   *
   * WHAT IS SAVED IS THE SQUARE, not the file chosen. It is cut in the browser and sent as a JPEG of
   * a fixed size, so a twelve-megapixel phone photograph becomes a picture of a few tens of
   * kilobytes, and nothing outside the frame is ever stored.
   *
   * The dialog does not know where the square goes. The record window saves it at once; New Person
   * holds it until the person is created. Both hand `onSave` the picture and say whether it landed.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import FileInput from "@magna-carta/design-system/file-input";
  import ZoomIn from "@lucide/svelte/icons/zoom-in";
  import ZoomOut from "@lucide/svelte/icons/zoom-out";
  import {
    clampOffset,
    clampZoom,
    cropScale,
    cropSource,
    MAXIMUM_ZOOM,
    MINIMUM_ZOOM,
    SAVED_PHOTO_SIDE,
    ZOOM_STEP,
    type CropOffset,
  } from "./photo-crop.ts";

  let {
    open = $bindable(false),
    heading,
    subject,
    onSave,
  }: {
    open?: boolean;
    /** "Add Photo" or "Change Photo". */
    heading: string;
    /** Whose picture it is, named under the heading. */
    subject: string;
    /** Hands over the cropped JPEG as base64; resolves to null once it landed, or why it did not. */
    onSave: (imageBase64: string) => Promise<string | null>;
  } = $props();

  /** The frame's side in canvas pixels. */
  const FRAME = 240;
  /** How far one arrow-key press moves the picture. */
  const KEY_STEP = 8;

  let canvas = $state<HTMLCanvasElement | null>(null);
  let chooser = $state<HTMLInputElement | null>(null);
  let image = $state<HTMLImageElement | null>(null);
  let zoom = $state(MINIMUM_ZOOM);
  let offset = $state<CropOffset>({ x: 0, y: 0 });
  let refusal = $state<string | null>(null);
  let dragFrom: { x: number; y: number; offset: CropOffset } | null = null;

  function reset(): void {
    image = null;
    zoom = MINIMUM_ZOOM;
    offset = { x: 0, y: 0 };
    refusal = null;
    if (chooser !== null) chooser.value = "";
  }

  async function choose(file: File | null): Promise<void> {
    refusal = null;
    if (file === null) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      refusal = "Choose a PNG or JPEG picture.";
      return;
    }
    const address = URL.createObjectURL(file);
    const loaded = new Image();
    loaded.src = address;
    try {
      await loaded.decode();
      image = loaded;
      zoom = MINIMUM_ZOOM;
      offset = { x: 0, y: 0 };
    } catch {
      refusal = "That file could not be read as a picture. Choose another.";
    } finally {
      URL.revokeObjectURL(address);
    }
  }

  function size(of: HTMLImageElement) {
    return { width: of.naturalWidth, height: of.naturalHeight };
  }

  /** Draws the frame: the picture as it will be cut, at this zoom and offset. */
  $effect(() => {
    const context = canvas?.getContext("2d");
    if (context === undefined || context === null) return;
    context.clearRect(0, 0, FRAME, FRAME);
    if (image === null) return;
    const source = cropSource(size(image), FRAME, zoom, offset);
    context.drawImage(image, source.x, source.y, source.side, source.side, 0, 0, FRAME, FRAME);
  });

  function setZoom(next: number): void {
    if (image === null) return;
    zoom = clampZoom(next);
    offset = clampOffset(size(image), FRAME, zoom, offset);
  }

  function moveBy(x: number, y: number): void {
    if (image === null) return;
    offset = clampOffset(size(image), FRAME, zoom, { x: offset.x + x, y: offset.y + y });
  }

  function onPointerDown(event: PointerEvent): void {
    if (image === null) return;
    canvas?.setPointerCapture(event.pointerId);
    dragFrom = { x: event.clientX, y: event.clientY, offset };
  }

  function onPointerMove(event: PointerEvent): void {
    if (dragFrom === null || image === null || canvas === null) return;
    // The canvas may be drawn smaller than its own pixels; a drag moves the picture by what the
    // reader's pointer travelled across what they see.
    const ratio = FRAME / canvas.getBoundingClientRect().width;
    offset = clampOffset(size(image), FRAME, zoom, {
      x: dragFrom.offset.x + (event.clientX - dragFrom.x) * ratio,
      y: dragFrom.offset.y + (event.clientY - dragFrom.y) * ratio,
    });
  }

  function onPointerUp(): void {
    dragFrom = null;
  }

  function onKeyDown(event: KeyboardEvent): void {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    moveBy(move[0], move[1]);
  }

  /** The square, cut from the original at full resolution and encoded as a JPEG. */
  async function croppedBase64(of: HTMLImageElement): Promise<string> {
    const output = document.createElement("canvas");
    output.width = SAVED_PHOTO_SIDE;
    output.height = SAVED_PHOTO_SIDE;
    const context = output.getContext("2d");
    if (context === null) throw new Error("The browser offered no canvas to cut the picture on.");
    const source = cropSource(size(of), FRAME, zoom, offset);
    context.drawImage(
      of,
      source.x,
      source.y,
      source.side,
      source.side,
      0,
      0,
      SAVED_PHOTO_SIDE,
      SAVED_PHOTO_SIDE,
    );
    const blob = await new Promise<Blob | null>((resolve) => {
      output.toBlob(resolve, "image/jpeg", 0.9);
    });
    if (blob === null) throw new Error("The browser could not encode the picture.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let start = 0; start < bytes.length; start += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    }
    return btoa(binary);
  }

  async function save(): Promise<ActionOutcome> {
    if (image === null) return "refused";
    refusal = null;
    let encoded: string;
    try {
      encoded = await croppedBase64(image);
    } catch (error) {
      refusal = error instanceof Error ? error.message : "The picture could not be prepared.";
      return "refused";
    }
    const answer = await onSave(encoded);
    if (answer !== null) {
      refusal = answer;
      return "refused";
    }
    return "committed";
  }

  const scale = $derived(image === null ? 1 : cropScale(size(image), FRAME, zoom));
</script>

<ActionDialog
  bind:open
  {heading}
  subtitle={{ facts: [subject] }}
  commitLabel="Save"
  commitBusyLabel="Saving"
  commitRefusal={image === null ? "Choose a picture first." : undefined}
  unsavedChanges={image !== null}
  onOpen={reset}
  onCommit={save}
>
  {#snippet notice()}
    {#if refusal !== null}
      <Alert.Root variant="danger">
        <Alert.Description>{refusal}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-wrap items-start gap-24">
      <div class="relative shrink-0 overflow-hidden rounded-md bg-surface-sunken">
        <!-- The frame. Its own pixels are fixed so the arithmetic has one size to work in. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <canvas
          bind:this={canvas}
          width={FRAME}
          height={FRAME}
          tabindex={image === null ? -1 : 0}
          aria-label={image === null
            ? "No picture chosen yet"
            : "The picture as it will be saved. Drag it, or use the arrow keys, to centre the face."}
          class="block touch-none focus-visible:outline-2 focus-visible:outline-focus-ring {image ===
          null
            ? ''
            : 'cursor-move'}"
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={onPointerUp}
          onkeydown={onKeyDown}
        ></canvas>
        <!-- The circle the picture is seen through everywhere else. -->
        <span
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 rounded-full border-2 border-accent-default"
        ></span>
      </div>

      <div class="flex min-w-0 grow flex-col gap-16">
        <FileInput
          bind:ref={chooser}
          accept="image/png,image/jpeg"
          disabled={busy}
          aria-label={image === null ? "Choose a picture" : "Choose a different picture"}
          onchange={(event) => void choose(event.currentTarget.files?.[0] ?? null)}
        />
        <div class="flex items-center gap-8">
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || image === null || zoom <= MINIMUM_ZOOM}
            onclick={() => setZoom(zoom - ZOOM_STEP)}
          >
            <ZoomOut class="size-16" aria-hidden="true" />
            Zoom Out
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || image === null || zoom >= MAXIMUM_ZOOM}
            onclick={() => setZoom(zoom + ZOOM_STEP)}
          >
            <ZoomIn class="size-16" aria-hidden="true" />
            Zoom In
          </Button>
        </div>
        <p class="text-sm text-text-muted">
          {#if image === null}
            A PNG or JPEG. It is cut to a square, and only the square is kept.
          {:else}
            Drag the picture, or use the arrow keys, to centre the face.
            {#if FRAME / scale < SAVED_PHOTO_SIDE / 2}
              This picture is small, so it may look soft.
            {/if}
          {/if}
        </p>
      </div>
    </div>
  {/snippet}
</ActionDialog>
