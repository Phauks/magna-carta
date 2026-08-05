import {
  expressionScopeFor,
  isLegalFormat,
  lookupDictionaryEntry,
  type DictionaryEntry,
} from "./dictionary.ts";
import { matchBlockRegions, parseBlockMarker } from "./blocks.ts";
import { legalFormatsFor } from "./format.ts";
import {
  checkExpression,
  layerScope,
  loopFrame,
  type CheckedExpression,
  type ExpressionScope,
} from "./expression/check.ts";
import { EXPRESSION_LIMITS } from "./expression/limits.ts";
import type { ExpressionFailure } from "./expression/errors.ts";
import type { ExpressionType } from "./expression/catalog.ts";
import { readPartText, writePartText, type PartMap } from "./ooxml/package.ts";
import { contentPartNames } from "./ooxml/parts.ts";
import { attributesOf, buildXml, nodeTag, parseXml, textOf, type XmlNode } from "./ooxml/xml.ts";
import type {
  FieldManifest,
  ManifestBlock,
  ManifestComputedField,
  ManifestField,
  MergeFieldDetection,
  MergeValueType,
  NormalizationWarning,
  PlaceholderForm,
  UnconvertedMergeField,
} from "./types.ts";

// Normalization is the load-bearing move of the whole subsystem: the fiddly, failure-prone half of DOCX
// templating — a placeholder Word split across five runs, a `{{` in one run and its `}}` in the next, a
// Word mail-merge field instead of typed text — runs ONCE per template version, at the moment a human is
// looking at the result, and its output is the version's stored bytes. Every assembly thereafter is a
// deterministic substitution over runs whose contents are already known.
//
// `{{key}}` text delimiters are the canonical form a paralegal types, and a registered template version
// carries exactly that one form, so nothing downstream has to understand two. Content controls
// (`w:sdt`) are a named seam, deferred until a browser authoring surface can emit them.
//
// A Word MERGEFIELD construct is an equivalent authoring form that CAN be converted into brace form
// here — but conversion is OPT-IN, never automatic. Rewriting a firm's uploaded template is a change to
// the firm's own document, so this pass always DETECTS what it found and reports it, and only rewrites
// when the caller explicitly asked.
//
// A template whose merge fields were NOT converted still registers. Nothing substitutes such a field, so
// it renders whatever result Word last cached in it — the silently-wrong-document failure the absence
// model exists to catch. Refusing the template would keep that failure out of the product at the price
// of also keeping the template out; recording each construct on the FIELD MANIFEST instead — its name,
// the part it sits in, and the frozen text it will print — puts it in front of the same absence model,
// so registration reports it, the field inspector shows it, and every assembly reports it again. The
// failure the refusal was guarding against is one the manifest can see; an unregisterable template is
// one nobody can inspect.

// The transform's version, recorded on every template version row. A normalizer change does not
// retroactively apply to already-registered versions — correct, since versions are immutable — but it
// does mean two versions registered under different normalizers can behave differently, so the version
// that produced a package's bytes is stored alongside them and the difference stays explicable.
export const NORMALIZER_VERSION = 2;

export type NormalizationFailureCode =
  | "unclosed-delimiter"
  | "stray-delimiter"
  | "empty-key"
  | "unknown-key"
  | "unknown-format"
  // The expression language's own findings, each with a character offset into the expression source.
  // `block-syntax-unsupported` retired with this pass: blocks are supported now, and a code meaning "we
  // refuse to read this" must not survive as a vaguer version of the codes that replace it.
  | "expression-syntax-error"
  | "expression-unknown-key"
  | "expression-type-error"
  | "expression-too-complex"
  | "expression-format-illegal"
  | "block-unbalanced"
  | "block-nesting-too-deep"
  | "unreadable-part";

// A failure the author has to fix, with enough location for the field inspector to point at it.
export interface NormalizationFailure {
  readonly code: NormalizationFailureCode;
  readonly part: string;
  // The paragraph text the finding sits in, clipped — enough for an author to find the spot without
  // reproducing a whole clause in an error payload.
  readonly excerpt: string;
  readonly detail: string;
}

export interface NormalizationResult {
  readonly parts: PartMap;
  readonly manifest: FieldManifest;
  readonly warnings: readonly NormalizationWarning[];
  readonly failures: readonly NormalizationFailure[];
  // Every Word merge field the pass found, whether or not it converted any of them. This is the
  // feedback half of the opt-in: it is what a caller shows an administrator so the decision to convert
  // is an informed one.
  readonly mergeFieldDetections: readonly MergeFieldDetection[];
  // The name-to-key mappings a conversion just CONFIRMED — emitted only when the caller opted in, and
  // only for names that mapped onto a merge field the dictionary has. This is what the firm's mapping
  // library records, so the next import of a document from the same source reuses the answer instead of
  // asking again.
  readonly confirmedMappings: readonly ConfirmedMergeFieldMapping[];
  readonly normalizerVersion: number;
}

export interface ConfirmedMergeFieldMapping {
  readonly fieldName: string;
  readonly mergeKey: string;
}

export interface NormalizeOptions {
  // OPT-IN. Absent or false: merge fields are detected and reported, recorded on the manifest as
  // unconverted, and the document is left exactly as authored. True: each one is rewritten into the
  // canonical brace form.
  readonly convertMergeFields?: boolean;
  // How a Word merge-field name maps onto a merge-field key. Identity by default; the firm's own
  // field-mapping library supplies it in the worker (see MergeFieldNameResolver).
  readonly resolveMergeFieldName?: MergeFieldNameResolver;
  // The dictionary expressions are checked against. Defaults to the platform's own; the seam is here
  // because the firm's `custom.<handle>` entries widen it per firm, and a template's expressions must
  // be checked against the dictionary THAT FIRM has rather than against the shipped catalogue.
  readonly dictionary?: readonly DictionaryEntry[];
}

const EXCERPT_LIMIT = 120;

function excerptOf(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= EXCERPT_LIMIT ? collapsed : `${collapsed.slice(0, EXCERPT_LIMIT)}…`;
}

// ---------------------------------------------------------------------------------------------
// Building the one run a normalized placeholder lives in
// ---------------------------------------------------------------------------------------------

// A `w:t` written by this pass always carries xml:space="preserve". Word strips leading and trailing
// whitespace from a text element that does not declare it, and a merge value legitimately begins or ends
// with a space; without the attribute the document would silently lose it at exactly the join between a
// substituted value and the sentence around it.
function textElement(text: string): XmlNode {
  return { "w:t": [{ "#text": text }], ":@": { "@_xml:space": "preserve" } };
}

function runElement(text: string, runProperties: XmlNode | undefined): XmlNode {
  const children: XmlNode[] = [];
  if (runProperties !== undefined) children.push(runProperties);
  children.push(textElement(text));
  return { "w:r": children };
}

function runPropertiesOf(run: XmlNode): XmlNode | undefined {
  const children = run["w:r"];
  if (!Array.isArray(children)) return undefined;
  return (children as XmlNode[]).find((child) => nodeTag(child) === "w:rPr");
}

// ---------------------------------------------------------------------------------------------
// Pass one — Word MERGEFIELD constructs to brace form
// ---------------------------------------------------------------------------------------------

// ` MERGEFIELD  "Client Name"  \* MERGEFORMAT ` -> `Client Name`. Returns undefined for any other field
// instruction (PAGE, DATE, TOC and the rest), which is left exactly as authored — those are Word's
// fields, not ours, and rewriting one would change what the document renders.
function mergeFieldNameOf(instruction: string): string | undefined {
  const match = /^\s*MERGEFIELD\s+(?:"([^"]*)"|([^\s\\]+))/i.exec(instruction);
  if (match === null) return undefined;
  return match[1] ?? match[2];
}

function fieldCharTypeOf(node: XmlNode): string | undefined {
  const children = node["w:r"];
  if (!Array.isArray(children)) return undefined;
  for (const child of children as XmlNode[]) {
    if (nodeTag(child) !== "w:fldChar") continue;
    const type = attributesOf(child)["@_w:fldCharType"];
    if (typeof type === "string") return type;
  }
  return undefined;
}

// The instruction text a run contributes. Word splits a long field instruction across several runs, so
// the caller concatenates these in document order before parsing.
function instructionTextOf(node: XmlNode): string {
  const children = node["w:r"];
  if (!Array.isArray(children)) return "";
  let text = "";
  for (const child of children as XmlNode[]) {
    if (nodeTag(child) !== "w:instrText") continue;
    for (const leaf of (child["w:instrText"] as XmlNode[] | undefined) ?? []) {
      text += textOf(leaf);
    }
  }
  return text;
}

// Maps a Word merge-field name onto a merge-field key. The identity mapping is the floor: a template
// authored against this platform names its fields the way the dictionary does, so `matter.number` maps
// to `matter.number` and an unrecognized name stays unrecognized rather than being guessed at — a
// `ClientName` that becomes `client.displayName` because it looked close is a silent binding decision
// on privileged content.
//
// It is injected because the mapping is the part that is a FIRM'S OWN KNOWLEDGE, not the engine's. The
// worker supplies a resolver backed by the firm's field-mapping library — the confirmed name-to-key
// mappings an administrator has already accepted (see field-mapping-statements.ts) — so a second import
// of documents from the same source reuses what the first one established. `fromLibrary` distinguishes
// the two, because a mapping the firm confirmed and a name that happened to match a dictionary key are
// different facts to put in front of the person deciding.
export interface MergeFieldMapping {
  readonly key: string;
  readonly fromLibrary: boolean;
}

export type MergeFieldNameResolver = (fieldName: string) => MergeFieldMapping;

const identityMergeFieldNameResolver: MergeFieldNameResolver = (fieldName) => ({
  key: fieldName,
  fromLibrary: false,
});

// Build a resolver over a firm's confirmed mappings, falling back to the identity mapping for a name
// the firm has never confirmed. Exported so the worker composes it from a single read of the library
// rather than issuing a lookup per field — the same batching rule the merge context follows.
export function mergeFieldNameResolverFor(
  confirmed: ReadonlyMap<string, string>,
): MergeFieldNameResolver {
  return (fieldName) => {
    const mapped = confirmed.get(fieldName);
    return mapped === undefined
      ? { key: fieldName, fromLibrary: false }
      : { key: mapped, fromLibrary: true };
  };
}

interface DetectionTally {
  fieldName: string;
  occurrences: number;
  form: "simple" | "complex";
  // Word's cached result for the first occurrence — the text the document prints today where this field
  // sits. The first is enough: an author needs to see that the field prints stale words, not a
  // concordance of every stale value in the file.
  frozenText: string;
}

interface ConversionTally {
  count: number;
  // The keys the conversion emitted, so the manifest can record that an occurrence arrived as a Word
  // merge field rather than as typed braces — without pass two having to know anything about fields.
  readonly keys: Set<string>;
  // Every construct found, converted or not. Detection is unconditional; conversion is not.
  readonly detections: Map<string, DetectionTally>;
  // Whether this pass is allowed to REWRITE what it finds. False means detect and report only, leaving
  // the firm's document exactly as it was authored.
  readonly convert: boolean;
  readonly resolveName: MergeFieldNameResolver;
}

function recordDetection(
  tally: ConversionTally,
  fieldName: string,
  form: "simple" | "complex",
  frozenText: string,
): void {
  const existing = tally.detections.get(fieldName);
  if (existing === undefined) {
    tally.detections.set(fieldName, { fieldName, occurrences: 1, form, frozenText });
    return;
  }
  existing.occurrences += 1;
  if (existing.frozenText === "") existing.frozenText = frozenText;
}

// The visible text a run subtree carries — the `w:t` leaves only, so a field's own machinery
// (`w:instrText`) and deleted text never count as something the document prints.
function visibleTextOf(node: XmlNode): string {
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

// Walk the complex field constructs (`begin` / `instrText` / `separate` / result / `end`) and simple
// fields (`w:fldSimple`) in one sibling list, recording every merge field found and — only when the
// caller opted in — rewriting each into the canonical brace form. Nesting is tracked by depth so a
// MERGEFIELD inside another field's result is handled once, at the level it belongs to.
function convertMergeFieldsInList(nodes: XmlNode[], tally: ConversionTally): XmlNode[] {
  const out: XmlNode[] = [];
  let index = 0;
  while (index < nodes.length) {
    const node = nodes[index];
    if (node === undefined) {
      index += 1;
      continue;
    }
    const tag = nodeTag(node);

    if (tag === "w:fldSimple") {
      const instruction = attributesOf(node)["@_w:instr"];
      const name = typeof instruction === "string" ? mergeFieldNameOf(instruction) : undefined;
      const children = Array.isArray(node["w:fldSimple"]) ? (node["w:fldSimple"] as XmlNode[]) : [];
      if (name !== undefined) {
        // A simple field's cached result is the visible text of its own children.
        recordDetection(tally, name, "simple", children.map(visibleTextOf).join(""));
        if (!tally.convert) {
          out.push(node);
          index += 1;
          continue;
        }
        const { key } = tally.resolveName(name);
        const resultRun = children.find((child) => nodeTag(child) === "w:r");
        out.push(
          runElement(
            `{{${key}}}`,
            resultRun === undefined ? undefined : runPropertiesOf(resultRun),
          ),
        );
        tally.count += 1;
        tally.keys.add(key);
      } else {
        out.push({ ...node, "w:fldSimple": convertMergeFieldsInList(children, tally) });
      }
      index += 1;
      continue;
    }

    if (tag === "w:r" && fieldCharTypeOf(node) === "begin") {
      const start = index;
      let depth = 0;
      let instruction = "";
      let firstResultRun: XmlNode | undefined;
      let resultText = "";
      let separated = false;
      let end = -1;
      for (let scan = index; scan < nodes.length; scan += 1) {
        const candidate = nodes[scan];
        if (candidate === undefined) continue;
        const characterType = nodeTag(candidate) === "w:r" ? fieldCharTypeOf(candidate) : undefined;
        if (characterType === "begin") {
          depth += 1;
          continue;
        }
        if (characterType === "end") {
          depth -= 1;
          if (depth === 0) {
            end = scan;
            break;
          }
          continue;
        }
        if (depth !== 1) continue;
        if (characterType === "separate") {
          separated = true;
          continue;
        }
        if (separated) {
          if (firstResultRun === undefined && nodeTag(candidate) === "w:r") {
            firstResultRun = candidate;
          }
          // Everything between `separate` and `end` is Word's cached result — the words this field
          // prints today, and will keep printing unless it is converted.
          resultText += visibleTextOf(candidate);
          continue;
        }
        instruction += instructionTextOf(candidate);
      }

      const name = end === -1 ? undefined : mergeFieldNameOf(instruction);
      if (name !== undefined) {
        recordDetection(tally, name, "complex", resultText);
        if (!tally.convert) {
          // Detected, reported, and left exactly as authored: the whole construct is emitted back
          // untouched so the firm's document is unchanged. What it will render is on the manifest.
          for (let scan = start; scan <= end; scan += 1) {
            const original = nodes[scan];
            if (original !== undefined) out.push(original);
          }
          index = end + 1;
          continue;
        }
        const { key } = tally.resolveName(name);
        out.push(
          runElement(
            `{{${key}}}`,
            firstResultRun === undefined ? undefined : runPropertiesOf(firstResultRun),
          ),
        );
        tally.count += 1;
        tally.keys.add(key);
        index = end + 1;
        continue;
      }
      // Not a merge field (or an unterminated construct): emit it exactly as authored.
      out.push(node);
      index = start + 1;
      continue;
    }

    if (tag !== undefined && Array.isArray(node[tag])) {
      out.push({ ...node, [tag]: convertMergeFieldsInList(node[tag] as XmlNode[], tally) });
      index += 1;
      continue;
    }
    out.push(node);
    index += 1;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Pass two — reassembling run-split brace placeholders
// ---------------------------------------------------------------------------------------------

interface TextLeaf {
  readonly holder: XmlNode; // the w:t element
  readonly text: string;
}

// Every w:t leaf under a paragraph, in document order. w:instrText and w:delText are deliberately not
// collected: instruction text is a field's machinery (pass one already dealt with it) and deleted text
// is not part of the document a reader sees, so a placeholder inside either is not a placeholder.
function collectTextLeaves(node: XmlNode, out: TextLeaf[]): void {
  const tag = nodeTag(node);
  if (tag === undefined) return;
  const children = node[tag];
  if (!Array.isArray(children)) return;
  if (tag === "w:t") {
    let text = "";
    for (const leaf of children as XmlNode[]) text += textOf(leaf);
    out.push({ holder: node, text });
    return;
  }
  for (const child of children as XmlNode[]) collectTextLeaves(child, out);
}

function setLeafText(holder: XmlNode, text: string): void {
  holder["w:t"] = [{ "#text": text }];
  holder[":@"] = { ...attributesOf(holder), "@_xml:space": "preserve" };
}

const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;

interface ParsedPlaceholder {
  readonly key: string;
  readonly format: string | null;
  readonly canonical: string;
}

// `key`, or `key:format`, with surrounding whitespace tolerated on both — a paralegal who types
// `{{ matter.number }}` has authored the same field as one who does not.
function parsePlaceholderBody(body: string): ParsedPlaceholder {
  const separator = body.indexOf(":");
  if (separator === -1) {
    const key = body.trim();
    return { key, format: null, canonical: `{{${key}}}` };
  }
  const key = body.slice(0, separator).trim();
  const format = body.slice(separator + 1).trim();
  return { key, format, canonical: `{{${key}:${format}}}` };
}

// `{{= expression}}` and `{{= expression:format}}`. The marker is deliberately distinct so a plain
// `{{matter.number}}` keeps exactly the meaning it always had — no registered template changes
// behaviour — and so an author reading a template can tell a lookup from a calculation at a glance.
//
// The format suffix is split at the LAST colon that is not inside quoted text: an expression may
// legitimately contain a colon inside a text literal, and splitting at the first one would cut a
// calculation in half.
export function splitComputedField(body: string): {
  readonly source: string;
  readonly format: string | null;
} {
  const inner = body.slice(body.indexOf("=") + 1);
  let insideText = false;
  let escaped = false;
  let separator = -1;
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      insideText = !insideText;
      continue;
    }
    if (character === ":" && !insideText) separator = index;
  }
  if (separator === -1) return { source: inner.trim(), format: null };
  return {
    source: inner.slice(0, separator).trim(),
    format: inner.slice(separator + 1).trim(),
  };
}

interface FieldAccumulator {
  key: string;
  format: string | null;
  occurrences: number;
  parts: Set<string>;
  forms: Set<PlaceholderForm>;
}

interface ComputedFieldAccumulator {
  source: string;
  format: string | null;
  resultType: string;
  part: string;
  keys: readonly string[];
  occurrences: number;
}

// Everything one part's walk accumulates. Carried as one object rather than six parameters, because the
// walk is recursive and a scope has to travel with it.
interface PartWalkState {
  readonly partName: string;
  readonly accumulators: Map<string, FieldAccumulator>;
  readonly computedFields: Map<string, ComputedFieldAccumulator>;
  readonly blocks: ManifestBlock[];
  readonly failures: NormalizationFailure[];
  readonly convertedKeys: ReadonlySet<string>;
  expressionCount: number;
}

function expressionFailureCodeOf(failure: ExpressionFailure): NormalizationFailureCode {
  return failure.code;
}

function normalizeParagraph(
  paragraph: XmlNode,
  scope: ExpressionScope,
  state: PartWalkState,
): void {
  const partName = state.partName;
  const accumulators = state.accumulators;
  const convertedKeys = state.convertedKeys;
  const failures = state.failures;
  const leaves: TextLeaf[] = [];
  collectTextLeaves(paragraph, leaves);
  if (leaves.length === 0) return;

  const joined = leaves.map((leaf) => leaf.text).join("");
  if (!joined.includes("{{") && !joined.includes("}}")) return;
  const excerpt = excerptOf(joined);

  // The replacement plan, in joined-paragraph coordinates: what to emit where a placeholder starts, and
  // which characters the placeholder consumed.
  const replacementAt = new Map<number, string>();
  const consumed = new Uint8Array(joined.length);
  let matched = 0;

  PLACEHOLDER_PATTERN.lastIndex = 0;
  for (const match of joined.matchAll(PLACEHOLDER_PATTERN)) {
    const start = match.index;
    const whole = match[0];
    const body = match[1] ?? "";

    // A block marker reaching here shares its paragraph with something else — the block walk consumes
    // the ones that sit alone, and reports the ones that do not. Skipped rather than reported twice.
    if (parseBlockMarker(body) !== undefined) continue;

    if (body.trimStart().startsWith("=")) {
      const canonical = normalizeComputedField(body, whole, scope, excerpt, state);
      if (canonical === undefined) continue;
      matched += 1;
      replacementAt.set(start, canonical);
      consumed.fill(1, start, start + whole.length);
      continue;
    }

    const parsed = parsePlaceholderBody(body);

    if (parsed.key === "") {
      failures.push({
        code: "empty-key",
        part: partName,
        excerpt,
        detail: `"${whole}" names no merge field.`,
      });
      continue;
    }
    const entry = lookupDictionaryEntry(parsed.key);
    // A placeholder inside a repeating block may name the current item's field or the loop's position
    // — `matter.parties.displayName`, `loop.index`. Those resolve against the SCOPE the block
    // established rather than against the dictionary, and they cost no read of their own, so they
    // never join the manifest's field list.
    const binding = entry === undefined ? scope.get(parsed.key) : undefined;
    if (entry === undefined && binding === undefined) {
      failures.push({
        code: "unknown-key",
        part: partName,
        excerpt,
        detail: parsed.key.startsWith("loop.")
          ? `"${parsed.key}" only means something inside a repeating block.`
          : `"${parsed.key}" is not a merge field this firm has. Check the field list for the spelling.`,
      });
      continue;
    }

    const legalRenderings =
      entry === undefined
        ? legalFormatsForExpressionType(binding?.type ?? "text")
        : legalFormatsFor(entry.valueType);
    if (parsed.format !== null && !legalRenderings.includes(parsed.format)) {
      failures.push({
        code: "unknown-format",
        part: partName,
        excerpt,
        detail: `"${parsed.format}" is not a rendering "${parsed.key}" supports.`,
      });
      continue;
    }
    // A collection is never written into a document: a repeating block walks it, and count and isEmpty
    // ask about it.
    if ((entry?.valueType ?? binding?.type) === "list") {
      failures.push({
        code: "expression-type-error",
        part: partName,
        excerpt,
        detail: `"${parsed.key}" is a collection, which cannot be written into a document. Walk it with a repeating block, or ask count or isEmpty about it.`,
      });
      continue;
    }

    matched += 1;
    replacementAt.set(start, parsed.canonical);
    consumed.fill(1, start, start + whole.length);

    // A loop-scoped name is not a merge field: the collection it comes from was read once, as a whole.
    if (entry === undefined) continue;

    const accumulatorKey = `${parsed.key} ${parsed.format ?? ""}`;
    let accumulator = accumulators.get(accumulatorKey);
    if (accumulator === undefined) {
      accumulator = {
        key: parsed.key,
        format: parsed.format,
        occurrences: 0,
        parts: new Set(),
        forms: new Set(),
      };
      accumulators.set(accumulatorKey, accumulator);
    }
    accumulator.occurrences += 1;
    accumulator.parts.add(partName);
    accumulator.forms.add(convertedKeys.has(parsed.key) ? "mergeField" : "brace");
  }

  // Anything left uncovered is a delimiter with no partner. Reported rather than passed through, because
  // a stray `{{` in a filed document is a visible defect and a lone `}}` usually means the opening brace
  // landed in a different paragraph.
  const residue = joined.replace(/\{\{[^{}]*\}\}/g, "");
  if (residue.includes("{{")) {
    failures.push({
      code: "unclosed-delimiter",
      part: partName,
      excerpt,
      detail: "A merge field opens with {{ and is never closed in the same paragraph.",
    });
  } else if (residue.includes("}}")) {
    failures.push({
      code: "stray-delimiter",
      part: partName,
      excerpt,
      detail: "A }} appears with no matching {{ in the same paragraph.",
    });
  }

  if (matched === 0) return;

  // Rewrite the leaves. Every character a placeholder consumed is dropped, and the whole canonical
  // placeholder is emitted at its start offset — which lands it in exactly one w:t, in the run that held
  // the opening brace, however many runs Word had scattered it across.
  let offset = 0;
  for (const leaf of leaves) {
    let rewritten = "";
    let touched = false;
    for (let index = 0; index < leaf.text.length; index += 1) {
      const absolute = offset + index;
      const replacement = replacementAt.get(absolute);
      if (replacement !== undefined) {
        rewritten += replacement;
        touched = true;
      }
      if (consumed[absolute] === 1) {
        touched = true;
        continue;
      }
      rewritten += leaf.text[index];
    }
    if (touched) setLeafText(leaf.holder, rewritten);
    offset += leaf.text.length;
  }
}

// One `{{= …}}` placeholder: parse, check against the scope it sits in, record it on the manifest, and
// return the canonical form to write back. Returns undefined when the expression failed, so the
// placeholder is left exactly as the author typed it — a registration that fails must not also rewrite
// the document it refused.
function normalizeComputedField(
  body: string,
  whole: string,
  scope: ExpressionScope,
  excerpt: string,
  state: PartWalkState,
): string | undefined {
  const { source, format } = splitComputedField(body);
  if (source === "") {
    state.failures.push({
      code: "expression-syntax-error",
      part: state.partName,
      excerpt,
      detail: `"${whole}" works nothing out.`,
    });
    return undefined;
  }

  const overBudget = countExpression(state, excerpt);
  if (overBudget) return undefined;

  const checked = checkExpression(source, {
    scope,
    required: "formattableScalar",
    format,
    legalFormats: legalFormatsForExpressionType,
  });
  if (!checked.ok) {
    state.failures.push(expressionFailure(checked.failure, source, state.partName, excerpt));
    return undefined;
  }

  const accumulatorKey = `${source} ${format ?? ""}`;
  const existing = state.computedFields.get(accumulatorKey);
  if (existing === undefined) {
    state.computedFields.set(accumulatorKey, {
      source,
      format,
      resultType: checked.value.resultType,
      part: state.partName,
      keys: checked.value.keys,
      occurrences: 1,
    });
  } else {
    existing.occurrences += 1;
  }

  return format === null ? `{{= ${source}}}` : `{{= ${source}:${format}}}`;
}

function expressionFailure(
  failure: ExpressionFailure,
  source: string,
  partName: string,
  excerpt: string,
): NormalizationFailure {
  return {
    code: expressionFailureCodeOf(failure),
    part: partName,
    excerpt,
    // The character offset is what lets the field inspector point INSIDE the expression rather than at
    // the paragraph it sits in.
    detail: `${failure.detail} (in "${source}", at character ${failure.offset + 1})`,
  };
}

// The format table, seen through the language's own type vocabulary.
function legalFormatsForExpressionType(type: ExpressionType): readonly string[] {
  return legalFormatsFor(type as MergeValueType);
}

function countExpression(state: PartWalkState, excerpt: string): boolean {
  state.expressionCount += 1;
  if (state.expressionCount > EXPRESSION_LIMITS.expressionsPerTemplateVersion) {
    state.failures.push({
      code: "expression-too-complex",
      part: state.partName,
      excerpt,
      detail: `a template may carry at most ${EXPRESSION_LIMITS.expressionsPerTemplateVersion} calculations and conditions.`,
    });
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// The block walk
// ---------------------------------------------------------------------------------------------

// One sibling list at a time, carrying the scope the enclosing repeating blocks established. Blocks
// match among SIBLINGS — a block that opens in a table cell and closes after the table is not a block
// whose removal has a meaning — and a repeat pushes exactly one more layer onto the name scope. The
// walk is the evaluator's only awareness that a loop exists.
function walkBlockChildren(
  children: readonly XmlNode[],
  scope: ExpressionScope,
  depth: number,
  state: PartWalkState,
): void {
  const structure = matchBlockRegions(children);
  for (const failure of structure.failures) {
    state.failures.push({
      code: "block-unbalanced",
      part: state.partName,
      excerpt: excerptOf(failure.text),
      detail: failure.detail,
    });
  }

  for (const region of structure.regions) {
    const marker = region.open.marker;
    if (marker.form !== "open") continue;
    const excerpt = excerptOf(region.open.text);

    if (depth + 1 > EXPRESSION_LIMITS.blockNestingDepth) {
      state.failures.push({
        code: "block-nesting-too-deep",
        part: state.partName,
        excerpt,
        detail: `blocks may nest at most ${EXPRESSION_LIMITS.blockNestingDepth} deep.`,
      });
      continue;
    }
    if (countExpression(state, excerpt)) continue;

    const checked = checkBlockExpression(marker.kind, marker.source, scope, state, excerpt);
    if (checked === undefined) continue;

    state.blocks.push({
      kind: marker.kind,
      source: marker.source,
      resultType: checked.resultType,
      part: state.partName,
      keys: checked.keys,
      depth,
    });

    const bodyScope = marker.kind === "each" ? loopScopeFor(checked, scope, state, excerpt) : scope;
    if (bodyScope === undefined) continue;
    walkBlockChildren(
      children.slice(region.openIndex + 1, region.closeIndex),
      bodyScope,
      depth + 1,
      state,
    );
  }

  for (let index = 0; index < children.length; index += 1) {
    if (structure.covered.has(index)) continue;
    const child = children[index];
    if (child === undefined) continue;
    visitUnit(child, scope, depth, state);
  }
}

function visitUnit(
  node: XmlNode,
  scope: ExpressionScope,
  depth: number,
  state: PartWalkState,
): void {
  const tag = nodeTag(node);
  if (tag === undefined) return;
  if (tag === "w:p") {
    normalizeParagraph(node, scope, state);
    return;
  }
  const children = node[tag];
  if (Array.isArray(children)) walkBlockChildren(children as XmlNode[], scope, depth, state);
}

function checkBlockExpression(
  kind: "if" | "unless" | "each",
  source: string,
  scope: ExpressionScope,
  state: PartWalkState,
  excerpt: string,
): CheckedExpression | undefined {
  // A BARE MERGE KEY as the whole condition keeps the meaning a plain placeholder always had, with one
  // disambiguation stated so it is never guessed: when the key's declared type is boolean, the
  // condition is its VALUE; for any other type, the condition is its PRESENCE — exactly has(key). A key
  // used inside a larger expression is always a value, never a presence test.
  const effectiveSource =
    kind === "each" ? source : rewriteBareKeyCondition(source, scope, kind === "unless");
  const checked = checkExpression(effectiveSource, {
    scope,
    required: kind === "each" ? "list" : "boolean",
  });
  if (!checked.ok) {
    state.failures.push(
      expressionFailure(checked.failure, effectiveSource, state.partName, excerpt),
    );
    return undefined;
  }
  return checked.value;
}

// `{{#if client.code}}` becomes `has(client.code)`; `{{#unless matter.eBilling}}` becomes
// `not matter.eBilling`. Rewriting the SOURCE rather than special-casing the tree means the manifest,
// the field inspector, and the assembly-time re-check all see the same expression the checker did.
export function rewriteBareKeyCondition(
  source: string,
  scope: ExpressionScope,
  negated: boolean,
): string {
  const trimmed = source.trim();
  const binding = scope.get(trimmed);
  const bare =
    binding !== undefined && /^[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+){1,2}$/.test(trimmed)
      ? binding.type === "boolean"
        ? trimmed
        : `has(${trimmed})`
      : trimmed;
  return negated ? `not (${bare})` : bare;
}

// The names a repeating block pushes into scope. `{{#each}}` takes a LIST-VALUED DICTIONARY KEY or the
// `allocate` helper, and nothing else — not an arbitrary expression, not a filtered list, not a sorted
// one. Expressions do not iterate; `{{#each}}` iterates data.
function loopScopeFor(
  checked: CheckedExpression,
  scope: ExpressionScope,
  state: PartWalkState,
  excerpt: string,
): ExpressionScope | undefined {
  const node = checked.node;
  if (node.kind === "name") {
    const binding = scope.get(node.name);
    return layerScope(scope, loopFrame(node.name, binding?.itemFields, undefined));
  }
  if (node.kind === "call" && node.helper.name === "allocate") {
    // A split's parts have no field names of their own, so the item is bound as `loop.value`.
    return layerScope(scope, loopFrame("", undefined, "money"));
  }
  state.failures.push({
    code: "expression-type-error",
    part: state.partName,
    excerpt,
    detail:
      "a repeating block walks a list the firm's own data supplies, or the parts of an allocate — not a calculation. Name the collection, or write allocate(amount, parts).",
  });
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------------------------

export function normalizeTemplate(
  parts: PartMap,
  options: NormalizeOptions = {},
): NormalizationResult {
  const normalized: PartMap = new Map(parts);
  const accumulators = new Map<string, FieldAccumulator>();
  const warnings: NormalizationWarning[] = [];
  const failures: NormalizationFailure[] = [];
  const detections: MergeFieldDetection[] = [];
  const unconverted: UnconvertedMergeField[] = [];
  const confirmed = new Map<string, string>();
  const convert = options.convertMergeFields === true;
  const resolveName = options.resolveMergeFieldName ?? identityMergeFieldNameResolver;
  const computedFields = new Map<string, ComputedFieldAccumulator>();
  const blocks: ManifestBlock[] = [];
  const scope = expressionScopeFor(options.dictionary);
  // The expression budget is per TEMPLATE VERSION, not per part: a pathological upload cannot spread
  // its cost across a hundred headers.
  let expressionCount = 0;

  for (const partName of contentPartNames(normalized.keys())) {
    const xml = readPartText(normalized, partName);
    if (xml === undefined) {
      failures.push({
        code: "unreadable-part",
        part: partName,
        excerpt: "",
        detail: "The part could not be read as text.",
      });
      continue;
    }

    let nodes: XmlNode[];
    try {
      nodes = parseXml(xml);
    } catch {
      failures.push({
        code: "unreadable-part",
        part: partName,
        excerpt: "",
        detail: "The part is not well-formed XML.",
      });
      continue;
    }

    const tally: ConversionTally = {
      count: 0,
      keys: new Set(),
      detections: new Map(),
      convert,
      resolveName,
    };
    const converted = convertMergeFieldsInList(nodes, tally);

    for (const detection of tally.detections.values()) {
      const mapping = resolveName(detection.fieldName);
      const mapsToKnownField = lookupDictionaryEntry(mapping.key) !== undefined;
      detections.push({
        fieldName: detection.fieldName,
        mappedKey: mapping.key,
        part: partName,
        occurrences: detection.occurrences,
        form: detection.form,
        mapsToKnownField,
        mappedFromLibrary: mapping.fromLibrary,
        frozenText: detection.frozenText,
      });
      // A conversion that landed on a real merge field is a mapping the firm has now confirmed. An
      // unrecognized name is not confirmed by having been converted — it produced a placeholder naming
      // a field nobody has, which is a thing to fix rather than a thing to remember.
      if (convert && mapsToKnownField) confirmed.set(detection.fieldName, mapping.key);
      // Left as authored: recorded on the manifest so the template is registrable AND the field is
      // visible. Nothing substitutes it, so `frozenText` is what the assembled document will print.
      if (!convert) {
        unconverted.push({
          fieldName: detection.fieldName,
          mappedKey: mapping.key,
          part: partName,
          occurrences: detection.occurrences,
          form: detection.form,
          mapsToKnownField,
          frozenText: detection.frozenText,
        });
      }
    }

    if (tally.count > 0) {
      warnings.push({
        code: "merge-field-converted",
        part: partName,
        detail: `${tally.count} Word merge field${tally.count === 1 ? "" : "s"} rewritten into the {{field}} form this template now stores.`,
      });
    }
    if (!convert && tally.detections.size > 0) {
      const names = [...tally.detections.keys()].sort().join(", ");
      warnings.push({
        code: "merge-field-unconverted",
        part: partName,
        detail: `${tally.detections.size} Word merge field${tally.detections.size === 1 ? "" : "s"} (${names}) ${tally.detections.size === 1 ? "was" : "were"} left exactly as authored. Word merge fields are not filled in by this system, so every document assembled from this template prints the text Word last cached in ${tally.detections.size === 1 ? "it" : "them"}. Register again asking for them to be converted to this system's {{field}} form, or replace them in Word.`,
      });
    }

    const state: PartWalkState = {
      partName,
      accumulators,
      computedFields,
      blocks,
      failures,
      convertedKeys: tally.keys,
      expressionCount,
    };
    walkBlockChildren(converted, scope, 0, state);
    expressionCount = state.expressionCount;

    writePartText(normalized, partName, buildXml(converted));
  }

  const fields: ManifestField[] = [...accumulators.values()]
    .map((accumulator) => ({
      key: accumulator.key,
      format: accumulator.format,
      occurrences: accumulator.occurrences,
      parts: [...accumulator.parts].sort(),
      forms: [...accumulator.forms].sort(),
    }))
    .sort((left, right) =>
      left.key === right.key
        ? (left.format ?? "").localeCompare(right.format ?? "")
        : left.key.localeCompare(right.key),
    );

  const manifestComputedFields: ManifestComputedField[] = [...computedFields.values()]
    .map((accumulator) => ({
      source: accumulator.source,
      format: accumulator.format,
      resultType: accumulator.resultType,
      part: accumulator.part,
      keys: accumulator.keys,
      occurrences: accumulator.occurrences,
    }))
    .sort((left, right) => left.source.localeCompare(right.source));

  const totalOccurrences = fields.reduce((sum, field) => sum + field.occurrences, 0);
  if (
    failures.length === 0 &&
    fields.length === 0 &&
    unconverted.length === 0 &&
    blocks.length === 0 &&
    manifestComputedFields.length === 0
  ) {
    warnings.push({
      code: "no-placeholders",
      part: "",
      detail:
        "The template carries no merge fields, so every assembly of it produces the same document.",
    });
  }

  const byPartThenName = <T extends { part: string; fieldName: string }>(
    left: T,
    right: T,
  ): number =>
    left.part === right.part
      ? left.fieldName.localeCompare(right.fieldName)
      : left.part.localeCompare(right.part);

  return {
    parts: normalized,
    manifest: {
      fields,
      totalOccurrences,
      unconvertedMergeFields: unconverted.sort(byPartThenName),
      blocks,
      computedFields: manifestComputedFields,
    },
    warnings,
    failures,
    mergeFieldDetections: detections.sort(byPartThenName),
    confirmedMappings: [...confirmed.entries()]
      .map(([fieldName, mergeKey]) => ({ fieldName, mergeKey }))
      .sort((left, right) => left.fieldName.localeCompare(right.fieldName)),
    normalizerVersion: NORMALIZER_VERSION,
  };
}
