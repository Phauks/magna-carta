<script lang="ts">
  /*
   * Dropzone — the drag-and-drop upload surface (Tier 1: native elements, no Bits UI), built ON TOP
   * of the FileInput primitive. FileInput is deliberately the bare control; the full upload
   * experience composes over it, and this is that surface's first layer: a drop target that also
   * carries the real, focusable file input so the whole thing is keyboard- and screen-reader-operable
   * (a dropzone that only works with a mouse is not accessible). The FileInput is the accessible
   * control — Tab reaches it, its button opens the native picker, assistive tech announces it; the
   * drag surface is a pointer enhancement layered around that control, never a replacement for it.
   *
   * This primitive REJECTS NOTHING: it hands every dropped or picked file to the consumer via
   * `onFiles` and leaves validation (type, size, count) and the R2 upload wiring to the consumer.
   * There is deliberately no upload progress, file queue, or network code here — those compose above.
   * A drop is also mirrored into the underlying input's `files` (via a DataTransfer) so the input's
   * own filename display and any consumer reading `input.files` stay consistent with a keyboard pick.
   *
   * A FOLDER IS WELCOME WHERE THE CONSUMER SAYS SO. A browser reports a dropped folder as one
   * zero-byte file wearing the folder's name, so a surface that only reads `dataTransfer.files`
   * silently uploads a stub and loses the contents. A consumer that passes `onEntries` gets the
   * folder walked instead (./dropped-entries.ts): every file inside it, each with the path it sat
   * under, so the folder can be recreated at the other end. Without `onEntries`, drops behave as
   * they always did.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import CloudUpload from "@lucide/svelte/icons/cloud-upload";
  import FileInput from "../file-input/file-input.svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { carriesDraggedItems } from "../item-drag/item-drag.ts";
  import {
    entriesFromDataTransfer,
    entriesFromFileList,
    type DroppedEntry,
  } from "./dropped-entries.ts";

  let {
    label = "Upload files",
    prompt = "Drag files here, or use the button",
    accept,
    multiple = false,
    disabled = false,
    invalid = false,
    onFiles,
    onEntries,
    ref = $bindable(null),
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLInputElement> & {
    /** Accessible name for the underlying file input (its label for keyboard/SR users). */
    label?: string;
    /** The visible instruction shown above the input. */
    prompt?: string;
    /** Filter offered in the picker (the native `accept` attribute), e.g. `image/*,.pdf`. */
    accept?: string;
    /** Allow selecting or dropping more than one file. */
    multiple?: boolean;
    /** Disables the surface: drops are ignored and the input is muted and unfocusable. */
    disabled?: boolean;
    /**
     * The last file offered was refused. The surface turns to the danger register and says nothing
     * more: a field in error is marked by its edge, not by a sentence under it. The input carries
     * `aria-invalid` so assistive technology hears the same thing.
     */
    invalid?: boolean;
    /** What the surface takes, under the control: the formats, a size. Quiet text, the caller's. */
    children?: Snippet;
    /** Called with every dropped or picked file. Validation and upload are the consumer's. */
    onFiles?: (files: File[]) => void;
    /**
     * Called with every dropped or picked file AND the path it arrived under, folders walked. Given,
     * a dropped folder delivers its contents rather than a stub named after it; a folder picked
     * through a `webkitdirectory` input arrives the same way. Fires alongside `onFiles`.
     */
    onEntries?: (entries: DroppedEntry[]) => void;
  } = $props();

  // A counter, not a boolean: dragenter/dragleave fire for every descendant the pointer crosses, so
  // a single flag would flicker off over child elements. The surface is "drag-over" while depth > 0.
  let dragDepth = $state(0);
  const dragOver = $derived(dragDepth > 0);

  function emit(files: File[]) {
    if (files.length > 0) onFiles?.(files);
  }

  function emitEntries(entries: DroppedEntry[]) {
    if (entries.length > 0) onEntries?.(entries);
  }

  /*
   * A drag of the product's OWN items is a move, not an upload, and this surface declines it.
   *
   * The two gestures ride the same event and can cross the same square inch — the file manager's
   * list is an upload target AND the place a row is picked up to be filed into a folder — so they
   * are told apart by the PAYLOAD (see components/item-drag/item-drag.ts) rather than by where they
   * land. Declining is what leaves the drop for the move to take: a dropzone that lit up for a row
   * being filed would claim a drop it then silently swallows, since there are no `files` on it.
   *
   * It refuses only what it can positively identify as ours. Demanding `Files` on the way IN would
   * be the stricter rule and the wrong one: a transfer's type list is the browser's to populate and
   * a surface that goes dark for a real file drop is worse than one that lights up for a move.
   */
  function ondragenter(event: DragEvent) {
    if (disabled || carriesDraggedItems(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth += 1;
  }

  function ondragover(event: DragEvent) {
    if (disabled || carriesDraggedItems(event.dataTransfer)) return;
    // Preventing default on dragover is what marks the element a valid drop target.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function ondragleave() {
    if (disabled) return;
    dragDepth = Math.max(0, dragDepth - 1);
  }

  function ondrop(event: DragEvent) {
    if (disabled || carriesDraggedItems(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth = 0;
    const transfer = event.dataTransfer;
    const dropped = transfer?.files;
    if (!transfer || !dropped || dropped.length === 0) return;
    if (onEntries !== undefined) {
      // The walk is asynchronous (each folder level is a callback read), and the transfer is only
      // readable during the event, so its items are taken now and resolved after.
      void entriesFromDataTransfer(transfer).then((entries) =>
        emitEntries(multiple ? entries : entries.slice(0, 1)),
      );
    }
    const all = Array.from(dropped);
    const files = multiple ? all : all.slice(0, 1);
    // Mirror the drop into the underlying input so its filename display and any consumer reading
    // input.files match a keyboard pick. Some engines disallow the assignment — the consumer still
    // receives the files from onFiles regardless.
    if (ref) {
      try {
        const data = new DataTransfer();
        for (const file of files) data.items.add(file);
        ref.files = data.files;
      } catch {
        /* input.files not assignable here; onFiles below still delivers the files. */
      }
    }
    emit(files);
  }

  function onchange(event: Event & { currentTarget: HTMLInputElement }) {
    if (!event.currentTarget.files) return;
    emit(Array.from(event.currentTarget.files));
    emitEntries(entriesFromFileList(event.currentTarget.files));
  }
</script>

<div
  class={mergeClasses("mc-dropzone w-full", className)}
  data-dragover={dragOver ? "true" : undefined}
  data-disabled={disabled ? "true" : undefined}
  data-invalid={invalid ? "true" : undefined}
  {ondragenter}
  {ondragover}
  {ondragleave}
  {ondrop}
  {...restProps}
>
  <CloudUpload class="mc-dropzone-icon" aria-hidden="true" />
  <p class="mc-dropzone-prompt">{prompt}</p>
  <FileInput
    bind:ref
    {accept}
    {multiple}
    {disabled}
    aria-label={label}
    aria-invalid={invalid ? "true" : undefined}
    {onchange}
  />
  {#if children !== undefined}
    <div class="mc-dropzone-detail">{@render children()}</div>
  {/if}
</div>
