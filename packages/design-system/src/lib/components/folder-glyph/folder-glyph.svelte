<script lang="ts">
  /*
   * A folder, drawn as the firm marked it: its chosen glyph in its chosen colour.
   *
   * A folder's colour and mark are facts about the FOLDER, not about the rail — so the rail, the
   * file list and the icon view all have to draw them, and drawing them is one component rather
   * than three. It was one for a while by accident: the colour rules were written against the
   * tree's own class, so a folder the reader had coloured showed its colour in the rail and
   * reverted to a plain grey folder in the list beside it, which reads as the colour not having
   * been saved.
   *
   * The mark and the palette come from the folder-tree module, which is their home — this component
   * draws them, it does not decide them.
   */
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { folderGlyph } from "../folder-tree/palette.ts";
  import type { FolderColorName, FolderIconName } from "../folder-tree/types.ts";

  let {
    color,
    icon,
    open = false,
    class: className,
  }: {
    /** The folder's colour, or nothing for a folder nobody has coloured. */
    color?: FolderColorName;
    /** The folder's mark, or nothing for the plain folder glyph. */
    icon?: FolderIconName;
    /** Draw the open-folder glyph — the row the reader is standing in. */
    open?: boolean;
    class?: string;
  } = $props();

  const Glyph = $derived(folderGlyph(icon, open));
</script>

<Glyph
  class={mergeClasses("mc-folder-glyph", className)}
  data-folder-color={color ?? "none"}
  aria-hidden="true"
/>
