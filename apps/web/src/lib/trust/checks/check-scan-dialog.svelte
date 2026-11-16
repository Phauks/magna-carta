<script lang="ts">
  /*
   * A photograph or scan of one blank check, marked at its four corners and straightened.
   *
   * THE FOUR CORNERS ARE MARKED ON THE PICTURE ITSELF, as handles on the same board the stock editor
   * draws the check on, because a phone held at an angle gives a trapezoid and only the reader can
   * say where the paper's corners are. They start a little in from the picture's edges.
   *
   * WHAT IS KEPT IS THE STRAIGHTENED CHECK, not the photograph: 850 by 350 pixels, encoded here as
   * a PNG. Nothing is saved by this panel; the editor holds the scan until Save Layout, which is the
   * one commit on that screen.
   *
   * The straightening is pure arithmetic over 300,000 pixels, a few milliseconds, so it runs here. A
   * very large photograph is drawn down to a working size first, because the corners are marked by
   * hand and a hand is not more precise than that.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as PlacementBoard from "@magna-carta/design-system/placement-board";
  import Dropzone from "@magna-carta/design-system/dropzone";
  import {
    MAXIMUM_PHOTO_SOURCE_BYTES,
    PHOTO_ACCEPT,
    isOfferedPhotoFormat,
  } from "$lib/directory/photo-crop.ts";
  import {
    STRAIGHTENED_HEIGHT,
    STRAIGHTENED_WIDTH,
    startingCorners,
    straightenScan,
    type Corners,
    type RgbaImage,
  } from "./straighten-scan.ts";

  let {
    open = $bindable(false),
    stockName,
    onStraightened,
  }: {
    open?: boolean;
    /** The stock the scan is for, named under the heading. */
    stockName: string;
    /** The straightened check: its PNG as base64 for saving, and an object URL to draw now. */
    onStraightened: (scan: { readonly imageBase64: string; readonly previewUrl: string }) => void;
  } = $props();

  /** The longest side a photograph is worked at. */
  const WORKING_SIDE = 1_600;
  const CORNER_NAMES = ["Top left corner", "Top right corner", "Bottom right corner", "Bottom left corner"];

  let source = $state<RgbaImage | null>(null);
  let sourceUrl = $state<string | null>(null);
  let corners = $state<{ x: number; y: number }[]>([]);
  let refused = $state(false);
  let cannotStraighten = $state(false);

  function reset(): void {
    if (sourceUrl !== null) URL.revokeObjectURL(sourceUrl);
    source = null;
    sourceUrl = null;
    corners = [];
    refused = false;
    cannotStraighten = false;
  }

  async function choose(file: File | null): Promise<void> {
    refused = false;
    cannotStraighten = false;
    if (file === null) return;
    if (!isOfferedPhotoFormat(file) || file.size > MAXIMUM_PHOTO_SOURCE_BYTES) {
      refused = true;
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, WORKING_SIDE / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no canvas");
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const pixels = context.getImageData(0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob === null) throw new Error("no picture");
      if (sourceUrl !== null) URL.revokeObjectURL(sourceUrl);
      sourceUrl = URL.createObjectURL(blob);
      source = { width, height, data: pixels.data };
      corners = startingCorners(width, height).map((corner) => ({ ...corner }));
    } catch {
      refused = true;
    }
  }

  async function base64Of(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let start = 0; start < bytes.length; start += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    }
    return btoa(binary);
  }

  async function straighten(): Promise<ActionOutcome> {
    if (source === null || corners.length !== 4) return "refused";
    const flat = straightenScan(source, corners as unknown as Corners);
    if (flat === null) {
      cannotStraighten = true;
      return "refused";
    }
    const canvas = document.createElement("canvas");
    canvas.width = STRAIGHTENED_WIDTH;
    canvas.height = STRAIGHTENED_HEIGHT;
    const context = canvas.getContext("2d");
    if (context === null) return "refused";
    context.putImageData(new ImageData(new Uint8ClampedArray(flat.data), flat.width, flat.height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob === null) return "refused";
    onStraightened({ imageBase64: await base64Of(blob), previewUrl: URL.createObjectURL(blob) });
    reset();
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  heading="Set the Check Scan"
  subtitle={{ facts: [stockName] }}
  width="wide"
  commitLabel="Use This Scan"
  commitBusyLabel="Straightening"
  commitRefusal={source === null
    ? "Choose a photograph or scan of a blank check."
    : cannotStraighten
      ? "Those corners do not make a check. Move them to the paper's corners."
      : undefined}
  unsavedChanges={source !== null}
  onOpen={reset}
  onDismiss={reset}
  onCommit={straighten}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      {#if source !== null && sourceUrl !== null}
        <PlacementBoard.Root
          width={source.width}
          height={source.height}
          label="The photograph, with the check's four corners marked"
          image={sourceUrl}
        >
          <PlacementBoard.Outline points={corners} />
          {#each corners as corner, index (index)}
            <PlacementBoard.Handle
              x={corner.x}
              y={corner.y}
              label={CORNER_NAMES[index] ?? "Corner"}
              step={Math.max(1, Math.round(source.width / 400))}
              largeStep={Math.max(10, Math.round(source.width / 40))}
              onmove={(x, y) => {
                corners[index] = { x, y };
                cannotStraighten = false;
              }}
            />
          {/each}
        </PlacementBoard.Root>
      {/if}
      <Dropzone
        accept={PHOTO_ACCEPT}
        disabled={busy}
        invalid={refused}
        label={source === null ? "Choose a photograph or scan" : "Choose a different photograph"}
        prompt={source === null
          ? "Drag a photograph or scan of one blank check here, or choose one"
          : "Drag a different photograph here, or choose one"}
        onFiles={(files) => void choose(files[0] ?? null)}
      >
        Drag each corner onto the corner of the check.
      </Dropzone>
    </div>
  {/snippet}
</ActionDialog>
