<script lang="ts">
  /*
   * FileIcon — per-file-type identity for a file list (Tier 1: a native <span> wrapping one Lucide
   * <svg>, no Bits UI). It maps a content type and/or file name to a glyph, a tone and a real-text
   * badge via resolveFileIconPresentation() (resolve.ts owns the mapping), or draws a folder for
   * the folder rows a file list renders above its files.
   *
   * The wrapper is why this is not a bare icon: a badge has to sit ON the glyph, centred and flush
   * with its lower edge, and it is text rather than drawn geometry (we author no glyphs of our own
   * — every mark here comes from the installed Lucide package). So the glyph fills the box and the
   * badge is positioned against it, which needs a positioned parent. The wrapper IS the component's
   * box: a caller's class lands on it, so `size-16` or a recipe class sizes the whole composite
   * exactly as it sized the bare glyph before.
   *
   * Accessibility: the composite is decorative by default (aria-hidden) because the file name beside
   * it is the label, and the badge repeats what the File Type column already says. Pass `aria-label`
   * (or `aria-labelledby`, or a `title`) to make it a labelled image when it stands alone — the
   * wrapper then becomes role="img" with that name, and the glyph and badge stay hidden inside it.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { FileCategory } from "./file-types.ts";
  import { resolveFileIconPresentation } from "./resolve.ts";
  import { fileIconClasses, type FileIconSize } from "./variants.ts";

  let {
    contentType,
    fileName,
    category,
    folder = false,
    open = false,
    size = "default",
    ref = $bindable(null),
    class: className,
    "aria-hidden": ariaHidden,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> & {
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
    /** Box size of the whole composite. The badge is tuned to stay legible at each of them. */
    size?: FileIconSize;
  } = $props();

  const presentation = $derived(
    resolveFileIconPresentation({ contentType, fileName, category, folder, open }),
  );
  const Glyph = $derived(presentation.icon);

  // Decorative unless the caller gave the composite an accessible name of its own.
  const hasAccessibleName = $derived(
    restProps["aria-label"] !== undefined ||
      restProps["aria-labelledby"] !== undefined ||
      restProps.title !== undefined,
  );
</script>

<span
  bind:this={ref}
  class={mergeClasses(fileIconClasses({ size }), className)}
  role={hasAccessibleName ? "img" : undefined}
  aria-hidden={ariaHidden ?? (hasAccessibleName ? undefined : "true")}
  {...restProps}
>
  <Glyph class="mc-file-icon-glyph size-full" data-tone={presentation.tone} aria-hidden="true" />
  {#if presentation.badge}
    <span class="mc-file-icon-badge-band" aria-hidden="true">
      <span class="mc-file-icon-badge" data-tone={presentation.badge.tone}
        >{presentation.badge.text}</span
      >
    </span>
  {/if}
</span>
