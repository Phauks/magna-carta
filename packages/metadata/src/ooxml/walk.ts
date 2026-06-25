import { nodeTag, type XmlNode } from "./xml.ts";

// Matches the word-processing content parts that may carry tracked changes, hidden runs, and comment
// references: the main document body plus all header, footer, footnote, and endnote parts.
export const CONTENT_PART_PATTERN =
  /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/;

// The WordprocessingML revision/comment/hidden vocabulary, defined once and shared by the inspect and
// scrub modules. Accepting a tracked change means: drop REMOVE_TAGS (deleted/moved-out text), unwrap
// UNWRAP_TAGS (keep inserted/moved-in text), and drop PROP_CHANGE_TAGS (keep current formatting).
export const REMOVE_TAGS: ReadonlySet<string> = new Set(["w:del", "w:moveFrom"]);
export const UNWRAP_TAGS: ReadonlySet<string> = new Set(["w:ins", "w:moveTo"]);
export const PROP_CHANGE_TAGS: ReadonlySet<string> = new Set([
  "w:rPrChange",
  "w:pPrChange",
  "w:tblPrChange",
  "w:trPrChange",
  "w:tcPrChange",
  "w:sectPrChange",
  "w:numberingChange",
]);
export const TRACKED_CHANGE_TAGS: ReadonlySet<string> = new Set([
  ...REMOVE_TAGS,
  ...UNWRAP_TAGS,
  ...PROP_CHANGE_TAGS,
]);
export const COMMENT_REF_TAGS: ReadonlySet<string> = new Set([
  "w:commentReference",
  "w:commentRangeStart",
  "w:commentRangeEnd",
]);

// True when a run (w:r) is marked hidden via an enabled w:vanish in its run properties. A w:vanish
// with w:val "false"/"0" is disabled and does NOT hide the run.
export function runIsHidden(run: XmlNode): boolean {
  const children = run["w:r"];
  if (!Array.isArray(children)) return false;
  for (const child of children as XmlNode[]) {
    if (nodeTag(child) !== "w:rPr") continue;
    const rPr = child["w:rPr"];
    if (!Array.isArray(rPr)) continue;
    for (const prop of rPr as XmlNode[]) {
      if (nodeTag(prop) !== "w:vanish") continue;
      const attrs = (prop[":@"] ?? {}) as Record<string, unknown>;
      const val = attrs["@_w:val"];
      if (val === undefined || (val !== "false" && val !== "0")) return true;
    }
  }
  return false;
}
