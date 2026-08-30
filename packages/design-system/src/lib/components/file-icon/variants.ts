/*
 * FileIcon size classes — the house variant pattern (a plain typed record lookup, no DSL),
 * identical in shape to input/variants.ts.
 *
 * FileIcon carries a size axis where a bare Lucide glyph does not, and the reason is the badge.
 * The glyph alone can be sized by any utility class the caller likes; a badge riding it is a
 * composite that has to stay legible and stay centred on the glyph at whatever box it is given.
 * A closed set of sizes is what makes "the badge works at every size" a claim that can be proven
 * once per size instead of re-argued per caller. The recipe owns the boxes; this record names them.
 */

export type FileIconSize = "sm" | "default" | "lg";

const SIZE: Record<FileIconSize, string> = {
  sm: "mc-file-icon-sm",
  default: "mc-file-icon-md",
  lg: "mc-file-icon-lg",
};

/** The full recipe class string for a file icon: the base recipe plus its size. */
export function fileIconClasses(options: { size: FileIconSize }): string {
  return `mc-file-icon ${SIZE[options.size]}`;
}
