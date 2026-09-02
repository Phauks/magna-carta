/*
 * FolderGlyph — a folder drawn as the firm marked it, wherever a folder is drawn.
 *
 * The palette and the mark set live in the folder-tree module, which is their home; this component
 * is the one place either is rendered, so the rail, the file list and the icon view cannot disagree
 * about what a coloured folder looks like.
 */
import FolderGlyph from "./folder-glyph.svelte";

export default FolderGlyph;
export { FolderGlyph };
