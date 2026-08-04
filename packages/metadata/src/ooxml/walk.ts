import { nodeTag, type XmlNode } from "./xml.ts";

// Matches the word-processing content parts that may carry tracked changes, hidden runs, and comment
// references: the main document body plus all header, footer, footnote, and endnote parts.
export const CONTENT_PART_PATTERN =
  /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/;

// ---------------------------------------------------------------------------------------------
// The WordprocessingML revision vocabulary, defined once and shared by the inspect and scrub
// modules. "Accepting" every tracked change means producing the document a reviewer would get by
// pressing Accept All: the final text, with no record of who changed what, when, or from where.
// Each class below is a different shape of revision record and needs a different treatment.
// ---------------------------------------------------------------------------------------------

// Class 1 — content that is NOT part of the accepted document: deleted runs (w:del, whose text sits
// in w:delText/w:delInstrText children) and the abandoned origin of a move (w:moveFrom). The element
// and everything inside it goes.
export const REMOVE_TAGS: ReadonlySet<string> = new Set(["w:del", "w:moveFrom"]);

// Class 2 — content that IS part of the accepted document but is wrapped in a revision record:
// insertions and the destination of a move. The wrapper goes, its children are hoisted in place.
// (The same two elements also appear as empty markers inside w:rPr/w:trPr to mark an inserted
// paragraph mark or table row; hoisting nothing is the correct result there.)
export const UNWRAP_TAGS: ReadonlySet<string> = new Set(["w:ins", "w:moveTo"]);

// Class 3 — empty range markers that bracket a move or a custom-XML revision. They carry no text,
// but they DO carry w:author, w:date, and the move's bookmark name, and their positions disclose
// that a passage was moved and exactly where it came from and went to. Dropping only the w:moveFrom
// and w:moveTo elements leaves these behind, so an "accepted" document still narrates the move.
export const RANGE_MARKER_TAGS: ReadonlySet<string> = new Set([
  "w:moveFromRangeStart",
  "w:moveFromRangeEnd",
  "w:moveToRangeStart",
  "w:moveToRangeEnd",
  "w:customXmlInsRangeStart",
  "w:customXmlInsRangeEnd",
  "w:customXmlDelRangeStart",
  "w:customXmlDelRangeEnd",
  "w:customXmlMoveFromRangeStart",
  "w:customXmlMoveFromRangeEnd",
  "w:customXmlMoveToRangeStart",
  "w:customXmlMoveToRangeEnd",
]);

// Class 4 — property-change records: the PREVIOUS formatting of a run, paragraph, section, table,
// table row, table cell, or numbering, kept alongside the current formatting so the change can be
// rejected. Each carries w:author and w:date. Accepting keeps the current formatting, so the record
// goes; the element being formatted stays.
export const PROP_CHANGE_TAGS: ReadonlySet<string> = new Set([
  "w:rPrChange",
  "w:pPrChange",
  "w:sectPrChange",
  "w:tblPrChange",
  "w:tblPrExChange",
  "w:trPrChange",
  "w:tcPrChange",
  "w:numberingChange",
]);

// Class 5 — table cell revision markers inside w:tcPr. w:cellIns marks a cell added under tracked
// changes and w:cellMerge a cell merged or split; both are accepted by keeping the cell as it now
// stands and dropping the marker (which carries w:author/w:date). w:cellDel marks a DELETED cell and
// is handled structurally instead — see cellIsDeleted.
export const CELL_REVISION_TAGS: ReadonlySet<string> = new Set([
  "w:cellIns",
  "w:cellDel",
  "w:cellMerge",
]);

// Everything inspect counts as a tracked change. Structural row/cell deletions are counted
// separately by the walk, since their marker is nested in the row/cell properties.
export const TRACKED_CHANGE_TAGS: ReadonlySet<string> = new Set([
  ...REMOVE_TAGS,
  ...UNWRAP_TAGS,
  ...RANGE_MARKER_TAGS,
  ...PROP_CHANGE_TAGS,
  ...CELL_REVISION_TAGS,
]);

export const COMMENT_REF_TAGS: ReadonlySet<string> = new Set([
  "w:commentReference",
  "w:commentRangeStart",
  "w:commentRangeEnd",
]);

// Attributes named w:rsid* are revision save identifiers: a per-editing-session token stamped on
// every paragraph, run, and section touched in that session. They carry no visible content, but
// together they reconstruct how many sittings a document took and which passages were written in the
// same one — and the same identifiers recur across every document produced from a shared template,
// which links documents to each other. They are stripped alongside the rest of the edit history.
const REVISION_SAVE_IDENTIFIER_PREFIX = "@_w:rsid";

function childrenOf(node: XmlNode, tag: string): XmlNode[] {
  const children = node[tag];
  return Array.isArray(children) ? (children as XmlNode[]) : [];
}

export function attributesOf(node: XmlNode): Record<string, unknown> {
  return (node[":@"] ?? {}) as Record<string, unknown>;
}

export function revisionSaveIdentifierAttributeNames(node: XmlNode): string[] {
  return Object.keys(attributesOf(node)).filter((name) =>
    name.startsWith(REVISION_SAVE_IDENTIFIER_PREFIX),
  );
}

// True when the element's own property element (w:trPr on a row, w:tcPr on a cell) carries `marker`.
function propertyMarkerPresent(
  node: XmlNode,
  elementTag: string,
  propertiesTag: string,
  marker: string,
): boolean {
  for (const child of childrenOf(node, elementTag)) {
    if (nodeTag(child) !== propertiesTag) continue;
    for (const property of childrenOf(child, propertiesTag)) {
      if (nodeTag(property) === marker) return true;
    }
  }
  return false;
}

// A table row whose w:trPr carries w:del was deleted under tracked changes. Accepting the deletion
// removes the ROW, not just the marker: dropping the marker alone would leave the deleted row's text
// standing in a document the sender believes has had its deletions accepted.
export function rowIsDeleted(row: XmlNode): boolean {
  return propertyMarkerPresent(row, "w:tr", "w:trPr", "w:del");
}

// Likewise for a cell whose w:tcPr carries w:cellDel — the cell and its content go with it.
export function cellIsDeleted(cell: XmlNode): boolean {
  return propertyMarkerPresent(cell, "w:tc", "w:tcPr", "w:cellDel");
}

// True when a run (w:r) is marked hidden via an enabled w:vanish in its run properties. A w:vanish
// with w:val "false"/"0" is disabled and does NOT hide the run.
export function runIsHidden(run: XmlNode): boolean {
  for (const child of childrenOf(run, "w:r")) {
    if (nodeTag(child) !== "w:rPr") continue;
    for (const property of childrenOf(child, "w:rPr")) {
      if (nodeTag(property) !== "w:vanish") continue;
      const value = attributesOf(property)["@_w:val"];
      if (value === undefined || (value !== "false" && value !== "0")) return true;
    }
  }
  return false;
}
