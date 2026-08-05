import { nodeTag, textOf, type XmlNode } from "./ooxml/xml.ts";

// Conditional and repeating blocks, at the level of the DOCUMENT rather than the language.
//
// The unit rule, stated once and obeyed everywhere: a block marker is its own paragraph, and the marker
// paragraph is removed with the block. In a table, a marker in the FIRST CELL of a row makes the ROW the
// unit. Nothing here ever removes half a paragraph or half a row — a partial removal is how a document
// ends up "damaged" in Word, and a text assertion cannot see it.
//
// Open and close markers must be SIBLINGS. A block that opens in a table cell and closes after the table
// is not a block whose removal has a meaning, so it is an unbalanced-block failure at registration with
// a location rather than a guess at assembly time.

export type BlockKind = "if" | "unless" | "each";

export type BlockMarker =
  | { readonly form: "open"; readonly kind: BlockKind; readonly source: string }
  | { readonly form: "close"; readonly kind: BlockKind }
  // A `{{#...}}` or `{{/...}}` that names nothing this system has. Reported rather than read as a merge
  // field, because a template that silently treats `{{#iff x}}` as a field name assembles a document
  // with the marker text printed in it.
  | { readonly form: "unrecognized"; readonly text: string };

const OPEN_PATTERN = /^#(if|unless|each)\b([\s\S]*)$/;
const CLOSE_PATTERN = /^\/(if|unless|each)$/;

// Reads a placeholder BODY — the text between the braces, already assembled from however many runs Word
// split it across. Returns undefined for anything that is not a block marker at all.
export function parseBlockMarker(body: string): BlockMarker | undefined {
  const trimmed = body.trim();
  if (!trimmed.startsWith("#") && !trimmed.startsWith("/")) return undefined;

  const open = OPEN_PATTERN.exec(trimmed);
  if (open !== null) {
    const kind = open[1] as BlockKind;
    const source = (open[2] ?? "").trim();
    if (source === "") return { form: "unrecognized", text: trimmed };
    return { form: "open", kind, source };
  }

  const close = CLOSE_PATTERN.exec(trimmed);
  if (close !== null) return { form: "close", kind: close[1] as BlockKind };

  return { form: "unrecognized", text: trimmed };
}

// A conditional opens with `#if` or `#unless` and closes with either `{{/if}}` or `{{/unless}}` — the
// two read differently in a document and an author reaching for the one that matches their opener is
// not making a mistake. A repeat closes only with `{{/each}}`: a repeat and a condition are different
// units, and confusing them silently would expand or drop the wrong span.
export function closesBlock(opened: BlockKind, closing: BlockKind): boolean {
  return opened === "each" ? closing === "each" : closing !== "each";
}

// ---------------------------------------------------------------------------------------------
// Finding markers in the document
// ---------------------------------------------------------------------------------------------

const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;

// The visible text a node subtree carries — the `w:t` leaves only, so a field's own machinery
// (`w:instrText`) and deleted text never count as something the document prints.
export function visibleTextOf(node: XmlNode): string {
  const tag = nodeTag(node);
  if (tag === undefined) return "";
  const children = node[tag];
  if (!Array.isArray(children)) return "";
  if (tag === "w:t") {
    let text = "";
    for (const leaf of children as XmlNode[]) text += textOf(leaf);
    return text;
  }
  let text = "";
  for (const child of children as XmlNode[]) text += visibleTextOf(child);
  return text;
}

function firstCellOf(row: XmlNode): XmlNode | undefined {
  const children = row["w:tr"];
  if (!Array.isArray(children)) return undefined;
  return (children as XmlNode[]).find((child) => nodeTag(child) === "w:tc");
}

export interface UnitMarker {
  readonly marker: BlockMarker;
  // The whole placeholder as authored, for the failure message.
  readonly text: string;
  // Whether the unit carries text beyond the marker itself. A marker sharing its paragraph with prose
  // is an authoring mistake: removing the block would take the prose with it.
  readonly alone: boolean;
  // What the block's removal or repetition operates on.
  readonly unit: "paragraph" | "row";
}

// The block marker a sibling child carries, if any. A paragraph carries its own; a table row carries the
// one in its first cell, which is what makes the row the unit.
export function markerOfUnit(node: XmlNode): UnitMarker | undefined {
  const tag = nodeTag(node);
  if (tag === "w:p") return markerOfText(visibleTextOf(node), "paragraph");
  if (tag === "w:tr") {
    const cell = firstCellOf(node);
    if (cell === undefined) return undefined;
    return markerOfText(visibleTextOf(cell), "row");
  }
  return undefined;
}

function markerOfText(text: string, unit: "paragraph" | "row"): UnitMarker | undefined {
  PLACEHOLDER_PATTERN.lastIndex = 0;
  const matches = [...text.matchAll(PLACEHOLDER_PATTERN)];
  for (const match of matches) {
    const marker = parseBlockMarker(match[1] ?? "");
    if (marker === undefined) continue;
    const whole = match[0];
    const alone = matches.length === 1 && text.trim() === whole.trim();
    return { marker, text: whole, alone, unit };
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Matching open to close within one sibling list
// ---------------------------------------------------------------------------------------------

export interface BlockRegion {
  readonly open: UnitMarker;
  readonly openIndex: number;
  readonly closeIndex: number;
}

export type BlockStructureFailureCode = "block-unbalanced" | "block-marker-not-alone";

export interface BlockStructureFailure {
  readonly code: BlockStructureFailureCode;
  readonly text: string;
  readonly detail: string;
}

export interface BlockStructure {
  // TOP-LEVEL regions only. A nested block lives inside another's body and is matched when that body is
  // walked, so nesting depth is a property of the walk rather than of this list.
  readonly regions: readonly BlockRegion[];
  readonly failures: readonly BlockStructureFailure[];
  // Which child indices are inside some region at this level, so a caller can visit the rest.
  readonly covered: ReadonlySet<number>;
}

export function matchBlockRegions(children: readonly XmlNode[]): BlockStructure {
  const regions: BlockRegion[] = [];
  const failures: BlockStructureFailure[] = [];
  const covered = new Set<number>();
  const stack: { marker: UnitMarker; index: number }[] = [];

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) continue;
    const found = markerOfUnit(child);
    if (found === undefined) continue;

    if (found.marker.form === "unrecognized") {
      failures.push({
        code: "block-unbalanced",
        text: found.text,
        detail: `"${found.text}" is not a block this system knows. A block opens with {{#if …}}, {{#unless …}}, or {{#each …}} and closes with {{/if}}, {{/unless}}, or {{/each}}.`,
      });
      continue;
    }

    if (!found.alone) {
      failures.push({
        code: "block-marker-not-alone",
        text: found.text,
        detail: `"${found.text}" shares its ${found.unit} with other text. A block marker sits in a ${found.unit} of its own, because the whole ${found.unit} is what the block adds or removes.`,
      });
      continue;
    }

    if (found.marker.form === "open") {
      stack.push({ marker: found, index });
      continue;
    }

    const opened = stack.pop();
    if (opened === undefined) {
      failures.push({
        code: "block-unbalanced",
        text: found.text,
        detail: `"${found.text}" closes a block that was never opened here.`,
      });
      continue;
    }
    const openedKind = opened.marker.marker.form === "open" ? opened.marker.marker.kind : "if";
    if (!closesBlock(openedKind, found.marker.kind)) {
      failures.push({
        code: "block-unbalanced",
        text: found.text,
        detail: `"${opened.marker.text}" is closed by "${found.text}", which closes a different kind of block.`,
      });
      continue;
    }
    if (stack.length === 0) {
      regions.push({ open: opened.marker, openIndex: opened.index, closeIndex: index });
      for (let scan = opened.index; scan <= index; scan += 1) covered.add(scan);
    }
  }

  for (const unclosed of stack) {
    failures.push({
      code: "block-unbalanced",
      text: unclosed.marker.text,
      detail: `"${unclosed.marker.text}" opens a block that is never closed alongside it. A block opens and closes among the same paragraphs or the same table rows.`,
    });
  }

  return { regions, failures, covered };
}

// ---------------------------------------------------------------------------------------------
// Cloning
// ---------------------------------------------------------------------------------------------

// A structural copy of one unit, so a repeat's second iteration cannot share a node with its first.
// Every clone carries its OWN paragraph properties — its `w:numPr` and its `w:trPr` — which is what
// keeps a repeated list item numbered and a repeated table row banded.
export function deepCloneNode(node: XmlNode): XmlNode {
  const copy: XmlNode = {};
  for (const [key, value] of Object.entries(node)) {
    copy[key] = Array.isArray(value)
      ? (value as XmlNode[]).map((child) =>
          typeof child === "object" && child !== null ? deepCloneNode(child) : child,
        )
      : typeof value === "object" && value !== null
        ? { ...(value as Record<string, unknown>) }
        : value;
  }
  return copy;
}
