import { failed, succeeded, type Outcome } from "../types.ts";
import {
  readPackage,
  readPartText,
  writePackage,
  writePartText,
  type PackageLimits,
  type PackageReadFailure,
  type PartMap,
} from "./package.ts";
import { buildXml, childrenOf, nodeTag, parseXml, type XmlNode } from "./xml.ts";

// Accepting every tracked change in a word-processing package: the copy a document becomes on its
// way OUT of the platform.
//
// A document the browser editor opens records each insertion and deletion with its author, and the
// STORED document keeps those marks for as long as it lives — they are the document's own record of
// who changed what, and history reads them. A copy that leaves the firm must not carry them: a
// download handed to opposing counsel with every redline still in it is the failure this pass
// exists to close. So every outbound copy is produced from the stored bytes by accepting all
// changes here, and the stored bytes are never touched. The paths this binds are enumerated in
// apps/api-worker/src/editing/CLAUDE.md (_Every copy that leaves the platform_).
//
// This is an XML rewrite of the package, not a re-render. Handing the document to the office
// suite to "save as" would be a second answer to what the document looks like — fonts, spacing,
// field results — and the copy must be the member's document with the marks resolved, nothing
// else changed. The marks are the revision elements of WordprocessingML (ECMA-376 part 1, tracked
// revisions), and accepting them is mechanical:
//
//   - an insertion (`w:ins`, `w:moveTo`) keeps its content and loses the wrapper;
//   - a deletion (`w:del`, `w:moveFrom`) goes, content and all;
//   - a deleted paragraph mark (`w:del` on the paragraph mark's run properties) joins the paragraph
//     to the one after it, the way Word does: the merged paragraph keeps the FOLLOWING paragraph's
//     properties, because the mark that carried this paragraph's own is the thing being deleted;
//   - a deleted table row (`w:del` in `w:trPr`) takes its row; a deleted cell (`w:cellDel`) its cell;
//   - a property change (`w:rPrChange`, `w:pPrChange`, and the rest of the `*Change` family) is a
//     record of the OLD properties beside the current ones — accepting keeps the current and drops
//     the record;
//   - range markers (move ranges, custom XML ranges) are bookmarks of the revision and go with it.
//
// A part with no revision element in it is left byte-for-byte as it was: the pass parses only what
// it has to rewrite, and a document with nothing recorded comes back as the same bytes.

// Every part of a word-processing package that can carry revision markup: the body and the parts
// that hold authorable text, plus the comment text, the style and numbering definitions (a tracked
// style change is a `w:rPrChange` in styles.xml), and the glossary document's body.
export const REVISION_PART_PATTERN =
  /^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments|styles|numbering|glossary\/document)\.xml$/;

// The caps for a WORKING document rather than a template: a member's own file carries its images,
// and refusing it at the template cap would leave a plain letter with a letterhead photograph
// unexportable. Sized against the same 128 MiB isolate ceiling as the template caps, with the same
// arithmetic — the raw bytes, the inflated part map and the rebuilt output are all resident at once.
export const WORKING_DOCUMENT_PACKAGE_LIMITS: PackageLimits = {
  maxPackageBytes: 24 * 1024 * 1024,
  maxInflatedBytes: 40 * 1024 * 1024,
  maxEntryCount: 2048,
};

// The largest single part this pass will parse. The parsed tree of a part is several times the
// part's own size, and it is what the isolate cannot hold: a body part past this is a document of
// well over a thousand pages, and the honest answer for it is "unavailable" rather than an
// out-of-memory inside a queue consumer.
export const MAX_REVISION_PART_CHARACTERS = 6 * 1024 * 1024;

export type AcceptChangesFailure = PackageReadFailure | "part-too-large";

export interface AcceptedChanges {
  /** The package with every change accepted. The INPUT bytes when nothing was recorded in it. */
  readonly bytes: Uint8Array;
  /** How many revision elements were resolved. Zero means `bytes` is the input, untouched. */
  readonly acceptedMarks: number;
  /** The parts that were rewritten, in package order. */
  readonly rewrittenParts: readonly string[];
}

// The cheap gate before any parse: a part with none of these tags has nothing to accept. The
// `[A-Za-z]+Change` arm catches the whole property-change family in one place.
const REVISION_TAG_PATTERN =
  /<w:(?:ins|del|moveFrom|moveTo|cellIns|cellDel|cellMerge|customXml(?:Ins|Del|MoveFrom|MoveTo)Range(?:Start|End)|moveFromRange(?:Start|End)|moveToRange(?:Start|End)|[A-Za-z]+Change)\b/;

// Revision wrappers whose CONTENT survives: the wrapper goes and its children take its place.
const UNWRAPPED_TAGS: ReadonlySet<string> = new Set(["w:ins", "w:moveTo"]);

// Revision wrappers whose content goes with them.
const DROPPED_CONTENT_TAGS: ReadonlySet<string> = new Set(["w:del", "w:moveFrom"]);

// Elements that are only a record of the revision — property-change records, range bookmarks, cell
// revision markers — and are removed wherever they sit.
const DROPPED_MARKER_TAGS: ReadonlySet<string> = new Set([
  "w:rPrChange",
  "w:pPrChange",
  "w:sectPrChange",
  "w:tblPrChange",
  "w:tblPrExChange",
  "w:trPrChange",
  "w:tcPrChange",
  "w:tblGridChange",
  "w:numberingChange",
  "w:cellIns",
  "w:cellMerge",
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

// Property containers in which `w:ins` and `w:del` are MARKERS on the thing that owns them (a
// paragraph mark, a table row) rather than wrappers around content. Inside one of these the
// element has no children worth keeping; what it means is decided by the owner, below.
const PROPERTY_CONTAINER_TAGS: ReadonlySet<string> = new Set(["w:rPr", "w:trPr", "w:tcPr"]);

function hasChild(node: XmlNode, tag: string, childTags: ReadonlySet<string>): boolean {
  return childrenOf(node, tag).some((child) => {
    const childTag = nodeTag(child);
    return childTag !== undefined && childTags.has(childTag);
  });
}

function firstChild(node: XmlNode, tag: string, childTag: string): XmlNode | undefined {
  return childrenOf(node, tag).find((child) => nodeTag(child) === childTag);
}

// A paragraph whose MARK is deleted: `w:p/w:pPr/w:rPr/w:del` (or `w:moveFrom`). Read before the
// walk removes the marker, since the marker is what says the paragraph joins the next one.
function paragraphMarkIsDeleted(paragraph: XmlNode): boolean {
  const properties = firstChild(paragraph, "w:p", "w:pPr");
  if (properties === undefined) return false;
  const markProperties = firstChild(properties, "w:pPr", "w:rPr");
  return markProperties !== undefined && hasChild(markProperties, "w:rPr", DROPPED_CONTENT_TAGS);
}

function rowIsDeleted(row: XmlNode): boolean {
  const properties = firstChild(row, "w:tr", "w:trPr");
  return properties !== undefined && hasChild(properties, "w:trPr", DROPPED_CONTENT_TAGS);
}

function cellIsDeleted(cell: XmlNode): boolean {
  const properties = firstChild(cell, "w:tc", "w:tcPr");
  return properties !== undefined && hasChild(properties, "w:tcPr", new Set(["w:cellDel"]));
}

interface WalkState {
  accepted: number;
}

// One sibling list. Wrappers are resolved where they sit; a deleted row or cell is dropped whole;
// everything else recurses. Paragraphs whose mark is deleted are noted on the way in and joined on
// the way out, once every sibling is in its final shape.
function acceptChildren(
  children: readonly XmlNode[],
  parentTag: string | undefined,
  state: WalkState,
): XmlNode[] {
  const out: XmlNode[] = [];
  const joinsNext = new Set<XmlNode>();

  for (const child of children) {
    const tag = nodeTag(child);
    if (tag === undefined) {
      out.push(child);
      continue;
    }
    const insideProperties = parentTag !== undefined && PROPERTY_CONTAINER_TAGS.has(parentTag);

    if (UNWRAPPED_TAGS.has(tag)) {
      state.accepted += 1;
      // Inside a property container the element is a marker with nothing to keep; elsewhere its
      // content moves up to take its place, walked as siblings of the wrapper's own siblings.
      if (!insideProperties) out.push(...acceptChildren(childrenOf(child, tag), parentTag, state));
      continue;
    }
    if (DROPPED_CONTENT_TAGS.has(tag) || DROPPED_MARKER_TAGS.has(tag)) {
      state.accepted += 1;
      continue;
    }
    if (tag === "w:tr" && rowIsDeleted(child)) {
      state.accepted += 1;
      continue;
    }
    if (tag === "w:tc" && cellIsDeleted(child)) {
      state.accepted += 1;
      continue;
    }
    if (tag === "w:p" && paragraphMarkIsDeleted(child)) joinsNext.add(child);

    child[tag] = acceptChildren(childrenOf(child, tag), tag, state);
    out.push(child);
  }

  return joinsNext.size === 0 ? out : joinParagraphs(out, joinsNext);
}

// Joins each paragraph whose mark was deleted to the paragraph that follows it. Walked from the end
// so a run of deleted marks folds into the one surviving paragraph in order. A paragraph with no
// paragraph directly after it (the last in a cell or a body, or one followed by a table) keeps its
// mark: there is nothing to join it to, and dropping it would lose its text.
function joinParagraphs(siblings: XmlNode[], joinsNext: ReadonlySet<XmlNode>): XmlNode[] {
  const out = [...siblings];
  for (let index = out.length - 2; index >= 0; index -= 1) {
    const paragraph = out[index];
    if (paragraph === undefined || !joinsNext.has(paragraph)) continue;
    const next = out[index + 1];
    if (next === undefined || nodeTag(next) !== "w:p") continue;
    const content = childrenOf(paragraph, "w:p").filter((child) => nodeTag(child) !== "w:pPr");
    const nextChildren = childrenOf(next, "w:p");
    const nextProperties = nextChildren.findIndex((child) => nodeTag(child) === "w:pPr");
    const insertAt = nextProperties === -1 ? 0 : nextProperties + 1;
    next["w:p"] = [...nextChildren.slice(0, insertAt), ...content, ...nextChildren.slice(insertAt)];
    out.splice(index, 1);
  }
  return out;
}

function acceptInPart(text: string, state: WalkState): string {
  const nodes = parseXml(text);
  const accepted = acceptChildren(nodes, undefined, state);
  return buildXml(accepted);
}

export function acceptTrackedChanges(
  bytes: Uint8Array,
  limits: PackageLimits = WORKING_DOCUMENT_PACKAGE_LIMITS,
): Outcome<AcceptedChanges, AcceptChangesFailure> {
  const read = readPackage(bytes, limits);
  if (!read.ok) return read;
  const parts: PartMap = read.value;

  const state: WalkState = { accepted: 0 };
  const rewrittenParts: string[] = [];
  for (const name of parts.keys()) {
    if (!REVISION_PART_PATTERN.test(name)) continue;
    const text = readPartText(parts, name);
    if (text === undefined || !REVISION_TAG_PATTERN.test(text)) continue;
    if (text.length > MAX_REVISION_PART_CHARACTERS) {
      return failed(
        "part-too-large",
        `${name} is ${text.length} characters, over ${MAX_REVISION_PART_CHARACTERS}`,
      );
    }
    const before = state.accepted;
    const rewritten = acceptInPart(text, state);
    if (state.accepted === before) continue;
    writePartText(parts, name, rewritten);
    rewrittenParts.push(name);
  }

  if (rewrittenParts.length === 0) {
    return succeeded({ bytes, acceptedMarks: 0, rewrittenParts: [] });
  }
  return succeeded({
    bytes: writePackage(parts),
    acceptedMarks: state.accepted,
    rewrittenParts,
  });
}
