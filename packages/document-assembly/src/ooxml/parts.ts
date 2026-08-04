// The Open Packaging Conventions part names and patterns every pass in this package shares. One home,
// for the same reason packages/metadata/src/ooxml/parts.ts keeps one: a part that one pass rewrites and
// another does not scan is a placeholder that survives normalization and reaches an assembled document
// unsubstituted.

export const CONTENT_TYPES_PART = "[Content_Types].xml";

// The word-processing parts that carry visible, authorable text — the main document body plus every
// header, footer, footnote, and endnote part. A firm's letterhead placeholders live in a header and its
// remit-to block in a footer, so a normalization or substitution pass restricted to word/document.xml
// would leave exactly the fields a letter template depends on unbound.
export const CONTENT_PART_PATTERN =
  /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/;

// Any relationship part, in any directory — including the package-root "_rels/.rels", whose file name
// is nothing but the extension.
export const RELS_PART_PATTERN = /(^|\/)_rels\/[^/]*\.rels$/;

// The parts a WordprocessingML package cannot open without. A package missing either is not a `.docx`
// however it was named, and is refused before any transform touches it.
export const REQUIRED_PARTS: readonly string[] = [CONTENT_TYPES_PART, "word/document.xml"];

// Returns the content-bearing parts of a part map, in a stable order so two runs over the same package
// visit them identically (and so a manifest's part list is reproducible).
export function contentPartNames(partNames: Iterable<string>): string[] {
  return [...partNames].filter((name) => CONTENT_PART_PATTERN.test(name)).sort();
}
