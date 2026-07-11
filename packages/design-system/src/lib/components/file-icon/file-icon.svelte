<script lang="ts">
  /*
   * FileIcon — per-file-type iconography for a file list (Tier 1: a single Lucide <svg>, no Bits UI).
   * It maps a content type and/or file name to the right glyph via resolveFileIcon() (resolve.ts owns
   * the mapping), or draws a folder for the folder rows a file list renders above its files. Size is
   * fixed by the mc-file-icon recipe — there is deliberately no `size` prop; a caller wanting a
   * different size does it with a utility class, which the recipe leaves free.
   *
   * Accessibility: the glyph is decorative by default (aria-hidden) because the file name beside it is
   * the label. Pass `aria-label` (or Lucide's `title`) to make it a labelled image when it stands
   * alone — the wrapper then drops the aria-hidden so the name is announced.
   */
  import type { ComponentProps } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { resolveFileIcon, type FileCategory, type FileIconComponent } from "./resolve.ts";

  // The glyph is a Lucide <svg> component; its own prop type (svg attributes + Lucide's `title`) is
  // the pass-through surface, so `bind:ref` is not offered (Lucide exposes no bindable ref).
  type IconProps = ComponentProps<FileIconComponent>;

  let {
    contentType,
    fileName,
    category,
    folder = false,
    open = false,
    class: className,
    "aria-hidden": ariaHidden,
    ...restProps
  }: IconProps & {
    /** The file's MIME type — authoritative when present (a server-set type beats the extension). */
    contentType?: string;
    /** The file name; its extension is used when the content type is absent or unrecognized. */
    fileName?: string;
    /** Explicit kind override — skips content-type/extension resolution. */
    category?: FileCategory;
    /** Render the folder glyph (the folder rows a file list draws above its files). */
    folder?: boolean;
    /** When `folder`, draw the open-folder glyph instead of the closed one. */
    open?: boolean;
  } = $props();

  const Icon = $derived(resolveFileIcon({ contentType, fileName, category, folder, open }));

  // Decorative unless the caller gave the glyph an accessible name of its own.
  const hasAccessibleName = $derived(
    restProps["aria-label"] !== undefined ||
      restProps["aria-labelledby"] !== undefined ||
      restProps.title !== undefined,
  );
</script>

<Icon
  class={mergeClasses("mc-file-icon", className)}
  aria-hidden={ariaHidden ?? (hasAccessibleName ? undefined : "true")}
  {...restProps}
/>
