import { failed, succeeded, type Outcome } from "../types.ts";
import {
  MAX_REVISION_PART_CHARACTERS,
  REVISION_PART_PATTERN,
  WORKING_DOCUMENT_PACKAGE_LIMITS,
  type AcceptChangesFailure,
} from "./accept-tracked-changes.ts";
import { readPackage, readPartText, type PackageLimits } from "./package.ts";
import { attributesOf, childrenOf, nodeTag, parseXml, textOf, type XmlNode } from "./xml.ts";

// Reading a word-processing package's tracked changes: who changed what, and where.
//
// The other half of accept-tracked-changes.ts. That pass resolves the revision elements of
// WordprocessingML on the way out; this one reads them into a list, so history can say per version
// "Ana: 3 additions, 2 removals · Trevor: 1 formatting change" and show the words. It walks the
// same tree over the same parts, and what it reads is exactly what the accept pass would resolve
// — so a document the pass leaves untouched reads as no marks.
//
// WHAT A MARK IS HERE. One row per revision element, with the words it carries: an insertion or
// deletion of runs (`w:ins`, `w:del`, and the two halves of a move, read as an insertion and a
// deletion), a paragraph mark inserted or deleted (the paragraph break itself, carried as a line
// break so a reader can tell "joined two paragraphs" from "deleted nothing"), a table row or cell
// inserted or deleted (with the text it held), and a property change (formatting: the words the
// change sits on, or none for a paragraph's or table's own properties). Range markers carry no
// author's words and are not marks.
//
// ADJACENT MARKS FOLD. Word and the browser editor split a single act of typing across many runs
// — a language tag, a spelling mark, a revision identifier — each wrapped in its own `w:ins` with
// the same author and time. Consecutive marks in one paragraph by the same author, of the same
// kind, at the same instant, are read as one mark with their words joined, so "hereby " and
// "orders" are one insertion rather than two.

export type TrackedChangeKind = "insertion" | "deletion" | "formatting";

export interface TrackedChange {
  readonly kind: TrackedChangeKind;
  /** The author's name as the document holds it: a display name, never a member identifier. */
  readonly author: string;
  /** The instant the document records for the change, as written (usually ISO 8601), or null. */
  readonly changedAt: string | null;
  /** The words the change carries: inserted, deleted, or reformatted. A paragraph break is "\n". */
  readonly text: string;
  /** The package part the change sits in: the body, a header, a footnote. */
  readonly part: string;
  /** The paragraph within the part, counted from zero in document order. */
  readonly paragraphIndex: number;
}

export interface TrackedChanges {
  readonly changes: readonly TrackedChange[];
}

// A revision element's own attributes; `w:author` is what the document holds.
interface Revision {
  readonly author: string;
  readonly changedAt: string | null;
}

function revisionOf(node: XmlNode): Revision {
  const attributes = attributesOf(node);
  const author = attributes["@_w:author"];
  const date = attributes["@_w:date"];
  return {
    author: typeof author === "string" ? author : "",
    changedAt: typeof date === "string" && date !== "" ? date : null,
  };
}

// The visible words under a node: every `w:t`, `w:delText`, tab and break, in document order.
function wordsOf(node: XmlNode): string {
  const tag = nodeTag(node);
  if (tag === undefined) return "";
  if (tag === "w:t" || tag === "w:delText") {
    return childrenOf(node, tag).map(textOf).join("");
  }
  if (tag === "w:tab") return "\t";
  if (tag === "w:br" || tag === "w:cr") return "\n";
  return childrenOf(node, tag).map(wordsOf).join("");
}

const INSERTION_TAGS: ReadonlySet<string> = new Set(["w:ins", "w:moveTo", "w:cellIns"]);
const DELETION_TAGS: ReadonlySet<string> = new Set(["w:del", "w:moveFrom", "w:cellDel"]);
const FORMATTING_TAGS: ReadonlySet<string> = new Set([
  "w:rPrChange",
  "w:pPrChange",
  "w:sectPrChange",
  "w:tblPrChange",
  "w:tblPrExChange",
  "w:trPrChange",
  "w:tcPrChange",
  "w:tblGridChange",
  "w:numberingChange",
]);
const PROPERTY_CONTAINER_TAGS: ReadonlySet<string> = new Set(["w:rPr", "w:trPr", "w:tcPr"]);

interface ReadState {
  readonly part: string;
  paragraphIndex: number;
  readonly changes: TrackedChange[];
}

function firstChild(node: XmlNode, tag: string, childTag: string): XmlNode | undefined {
  return childrenOf(node, tag).find((child) => nodeTag(child) === childTag);
}

function push(state: ReadState, kind: TrackedChangeKind, revision: Revision, text: string): void {
  const previous = state.changes.at(-1);
  if (
    previous !== undefined &&
    previous.kind === kind &&
    previous.author === revision.author &&
    previous.changedAt === revision.changedAt &&
    previous.part === state.part &&
    previous.paragraphIndex === state.paragraphIndex
  ) {
    state.changes[state.changes.length - 1] = { ...previous, text: previous.text + text };
    return;
  }
  state.changes.push({
    kind,
    author: revision.author,
    changedAt: revision.changedAt,
    text,
    part: state.part,
    paragraphIndex: state.paragraphIndex,
  });
}

// One node. The owner of a marker inside a property container decides what the marker means: a
// paragraph mark's `w:rPr` carries the paragraph break, a row's `w:trPr` the row's words, a cell's
// `w:tcPr` the cell's. `owner` is that node when the walk is inside its properties.
function read(
  node: XmlNode,
  parentTag: string | undefined,
  owner: XmlNode | undefined,
  state: ReadState,
): void {
  const tag = nodeTag(node);
  if (tag === undefined) return;
  const insideProperties = parentTag !== undefined && PROPERTY_CONTAINER_TAGS.has(parentTag);

  if (INSERTION_TAGS.has(tag) || DELETION_TAGS.has(tag)) {
    const kind: TrackedChangeKind = INSERTION_TAGS.has(tag) ? "insertion" : "deletion";
    if (insideProperties) {
      push(state, kind, revisionOf(node), ownedWords(owner, parentTag));
    } else {
      push(state, kind, revisionOf(node), wordsOf(node));
    }
    return;
  }
  if (FORMATTING_TAGS.has(tag)) {
    // A run's property change sits on that run's words; a paragraph's, a table's or a section's
    // has no words of its own. The record inside the change (the OLD properties) is not read.
    const words =
      tag === "w:rPrChange" && owner !== undefined && nodeTag(owner) === "w:r"
        ? wordsOf(owner)
        : "";
    push(state, "formatting", revisionOf(node), words);
    return;
  }

  if (tag === "w:p") {
    // The paragraph's own mark first, then its content in order, then the next paragraph.
    const properties = firstChild(node, "w:p", "w:pPr");
    if (properties !== undefined) read(properties, "w:p", node, state);
    for (const child of childrenOf(node, "w:p")) {
      if (child !== properties) read(child, "w:p", undefined, state);
    }
    state.paragraphIndex += 1;
    return;
  }

  const nextOwner =
    tag === "w:rPr" || tag === "w:trPr" || tag === "w:tcPr" || tag === "w:pPr"
      ? owner
      : tag === "w:r" || tag === "w:tr" || tag === "w:tc"
        ? node
        : owner;
  for (const child of childrenOf(node, tag)) read(child, tag, nextOwner, state);
}

// The words a marker inside a property container stands for.
function ownedWords(owner: XmlNode | undefined, container: string): string {
  if (owner === undefined) return "";
  if (container === "w:rPr" && nodeTag(owner) === "w:p") return "\n";
  return wordsOf(owner);
}

export function readTrackedChanges(
  bytes: Uint8Array,
  limits: PackageLimits = WORKING_DOCUMENT_PACKAGE_LIMITS,
): Outcome<TrackedChanges, AcceptChangesFailure> {
  const opened = readPackage(bytes, limits);
  if (!opened.ok) return opened;
  const parts = opened.value;

  const changes: TrackedChange[] = [];
  for (const name of parts.keys()) {
    if (!REVISION_PART_PATTERN.test(name)) continue;
    const text = readPartText(parts, name);
    if (
      text === undefined ||
      !/<w:(?:ins|del|moveFrom|moveTo|cell(?:Ins|Del)|[A-Za-z]+Change)\b/.test(text)
    ) {
      continue;
    }
    if (text.length > MAX_REVISION_PART_CHARACTERS) {
      return failed(
        "part-too-large",
        `${name} is ${text.length} characters, over ${MAX_REVISION_PART_CHARACTERS}`,
      );
    }
    const state: ReadState = { part: name, paragraphIndex: 0, changes: [] };
    for (const node of parseXml(text)) read(node, undefined, undefined, state);
    changes.push(...state.changes);
  }
  return succeeded({ changes });
}
