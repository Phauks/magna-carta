import {
  deepCloneNode,
  markerOfUnit,
  matchBlockRegions,
  parseBlockMarker,
  type BlockKind,
} from "./blocks.ts";
import { expressionScopeFor, lookupDictionaryEntry, type DictionaryEntry } from "./dictionary.ts";
import {
  checkExpression,
  layerScope,
  loopFrame,
  type CheckedExpression,
  type ExpressionScope,
} from "./expression/check.ts";
import type { ExpressionType } from "./expression/catalog.ts";
import {
  createEvaluationBudget,
  evaluate,
  type EvaluationBudget,
  type ExpressionValue,
  type ListItem,
} from "./expression/evaluate.ts";
import { EXPRESSION_LIMITS } from "./expression/limits.ts";
import { formatMergeValue, legalFormatsFor } from "./format.ts";
import { rewriteBareKeyCondition, splitComputedField } from "./normalize.ts";
import {
  contentTypeOverrides,
  readPackage,
  readPartText,
  writePackage,
  writePartText,
  type PartMap,
} from "./ooxml/package.ts";
import {
  addImagePart,
  addImageRelationship,
  declaredRelationships,
  embeddedRelationshipIds,
  inlineDrawingNode,
  readImageFacts,
  relationshipTargetFor,
} from "./ooxml/image.ts";
import { contentPartNames, CONTENT_TYPES_PART, REQUIRED_PARTS } from "./ooxml/parts.ts";
import { attributesOf, buildXml, nodeTag, parseXml, textOf, type XmlNode } from "./ooxml/xml.ts";
import type { MergeContext, MergeValue, MergeValueType } from "./types.ts";

// Substitution is deliberately the small half of this package. Because normalization already rewrote
// every placeholder into a single contiguous run and recorded the manifest, an assembly is a walk over
// known runs — no run reassembly, no delimiter hunting, no re-derivation of the hard part. That is what
// makes the per-assembly path cheap enough to stay in a Worker and makes output reproducible: the same
// template version plus the same merge context always yields the same bytes.
//
// The walk carries a SCOPE. A conditional either keeps its body or drops it whole; a repeat clones its
// body once per item with one more layer on the scope. Expressions are re-parsed and re-checked FROM
// THE SOURCE IN THE DOCUMENT rather than from a stored tree — which is the only thing that catches
// dictionary drift, where a template bound in March to a custom field archived in June must fail in
// September naming the key rather than evaluate against a tree that still believes it exists.
//
// The pass is purely subtractive, substitutive, and replicative. It never adds a part, a relationship, a
// script, or an external reference — whatever active content a template could have carried was stripped
// and re-verified at registration, and this pass has no mechanism to reintroduce any.

export type AssemblyFailureReason =
  | "unreadable-template"
  | "missing-required-field"
  | "package-integrity"
  // An expression the document carries no longer checks against the dictionary the firm has today, or
  // could not produce a value from data that all resolved. Both fail the assembly: a wrong branch is
  // invisible, because nobody reads a contract and notices the paragraph that is not there.
  | "expression-invalid"
  | "expression-refused"
  | "expression-unresolved";

export interface AssemblyAbsence {
  readonly key: string;
  // What the document shows where the value would have been. Never the value — there is none.
  readonly rendered: "blank" | "placeholder";
  // Why, when resolution knew why and the marker on the page does not say it — an ambiguous Directory
  // role names how many candidates the matter had. Null for an ordinary missing value: "the matter has
  // nothing here" is what the marker already says, and restating it would bury the cases that need
  // saying. Never a value.
  readonly reason: string | null;
}

// How many of each site the assembly worked out, and how each came out. No expression text, no
// merge-field key, and no value is ever carried here — the counts are what telemetry records.
export interface ExpressionTally {
  readonly site: "condition" | "repeat" | "computedField";
  readonly outcome: "resolved" | "unresolved" | "refused";
  readonly count: number;
}

export type AssemblyResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      // The KEYS that could not be resolved, never the values that could. The caller surfaces these as
      // warnings and the provenance row stores them; a document that completes with absences completes
      // with a list the caller has to show.
      readonly absences: readonly AssemblyAbsence[];
      readonly substitutions: number;
      readonly expressions: readonly ExpressionTally[];
    }
  | {
      readonly ok: false;
      readonly reason: AssemblyFailureReason;
      readonly detail: string;
      // For missing-required-field: which keys. A merge failure reports WHICH KEY failed, never what it
      // held.
      readonly keys: readonly string[];
      readonly expressions: readonly ExpressionTally[];
    };

// `client.displayName` -> `[CLIENT DISPLAY NAME]`. A visible marker is the deliberate bias of the absence
// model: the most dangerous failure in document assembly is a blank where a party name should be, filed
// without anyone noticing, and a marker is something a human reading the draft cannot miss.
export function absenceMarkerFor(key: string): string {
  const words = key
    .replace(/\./g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toUpperCase();
  return `[${words}]`;
}

// One absence, with whatever resolution was able to say about it. Every absence in the walk is recorded
// through here, so a key can never be recorded with a reason at one site and without it at another.
function recordAbsence(
  state: AssemblyState,
  key: string,
  rendered: AssemblyAbsence["rendered"],
): void {
  state.absences.set(key, {
    key,
    rendered,
    reason: state.context.absenceReasons.get(key) ?? null,
  });
}

// What resolution had to say about a key, appended to a failure message when it had anything. A block
// that will not resolve because the matter has three opposing parties should say so where the author
// reads the failure, not only in the absence list.
function reasonSuffix(state: AssemblyState, key: string): string {
  const reason = state.context.absenceReasons.get(key);
  return reason === undefined ? "" : ` ${reason}`;
}

const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;

interface TextLeaf {
  readonly holder: XmlNode;
  readonly text: string;
}

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

// ---------------------------------------------------------------------------------------------
// The merge context, as the expression language sees it
// ---------------------------------------------------------------------------------------------

// THE RESOLUTION BOUNDARY. An instant is projected to a calendar date in the matter's office's time
// zone exactly here, once, before the evaluator ever sees it — which is why there is no instant type in
// the language and no time-of-day arithmetic to write. An expression that could subtract hours would
// silently make a filing date depend on the hour the job happened to run.
export function expressionValueOf(
  value: MergeValue,
  timeZone: string,
): ExpressionValue | undefined {
  switch (value.kind) {
    case "text":
      return { kind: "text", text: value.text };
    case "date":
      return { kind: "date", isoDate: value.isoDate };
    case "instant": {
      const isoDate = formatMergeValue(value, "iso", { timeZone });
      return isoDate === undefined ? undefined : { kind: "date", isoDate };
    }
    case "money":
      return {
        kind: "money",
        amountMinor: value.amountMinor,
        currencyCode: value.currencyCode,
      };
    case "rate":
      return { kind: "rate", rateE4: value.rateE4, currencyCode: value.currencyCode };
    // The scale travels with the value: a firm's own numeric field declares its minor-unit exponent, and
    // an expression that received the stored integer at scale 0 would compute with a number a hundred
    // times too large and look entirely plausible doing it.
    case "number":
      return { kind: "number", significand: value.value, scale: value.scale };
    case "boolean":
      return { kind: "boolean", value: value.value };
    // AN IMAGE HAS NO EXPRESSION VALUE, deliberately and exhaustively: the language has no image type, so
    // there is nothing an expression could do with a picture. The key is absent from the scope for the
    // same reason, which is what makes `{{#if location.letterheadLogo}}` an unknown merge field at
    // registration rather than a type error nobody can act on.
    case "image":
      return undefined;
    case "list":
      return {
        kind: "list",
        items: value.items.map((item) => ({
          fields: new Map(
            [...item.fields].flatMap(([name, field]) => {
              const projected = expressionValueOf(field, timeZone);
              return projected === undefined ? [] : [[name, projected] as const];
            }),
          ),
        })),
      };
  }
}

function expressionValuesOf(context: MergeContext): ReadonlyMap<string, ExpressionValue> {
  const values = new Map<string, ExpressionValue>();
  for (const [key, value] of context.values) {
    const projected = expressionValueOf(value, context.timeZone);
    if (projected !== undefined) values.set(key, projected);
  }
  return values;
}

// ---------------------------------------------------------------------------------------------
// The assembly walk
// ---------------------------------------------------------------------------------------------

interface AssemblyState {
  readonly context: MergeContext;
  // The catalogue every key in the document is resolved against — the firm's, including its own
  // `custom.<handle>` bindings, not the platform's shipped list.
  readonly dictionary: readonly DictionaryEntry[] | undefined;
  readonly baseScope: ExpressionScope;
  readonly baseValues: ReadonlyMap<string, ExpressionValue>;
  readonly budget: EvaluationBudget;
  readonly absences: Map<string, AssemblyAbsence>;
  readonly missingRequired: Set<string>;
  readonly tallies: Map<string, number>;
  // The package being rewritten, and which part the walk is inside. A picture is a part plus a
  // relationship on the part that draws it, so a drawing cannot be emitted without both to hand.
  readonly parts: PartMap;
  currentPart: string;
  // Unique per drawing across the whole output. Word tolerates duplicate drawing ids; strict consumers
  // and accessibility checkers do not.
  drawings: number;
  substitutions: number;
  failure:
    | { readonly reason: AssemblyFailureReason; readonly detail: string; readonly keys: string[] }
    | undefined;
}

function tally(
  state: AssemblyState,
  site: ExpressionTally["site"],
  outcome: ExpressionTally["outcome"],
): void {
  const key = `${site} ${outcome}`;
  state.tallies.set(key, (state.tallies.get(key) ?? 0) + 1);
}

function talliesOf(state: AssemblyState): readonly ExpressionTally[] {
  return [...state.tallies.entries()]
    .map(([key, count]) => {
      const [site, outcome] = key.split(" ");
      return {
        site: site as ExpressionTally["site"],
        outcome: outcome as ExpressionTally["outcome"],
        count,
      };
    })
    .sort((left, right) =>
      left.site === right.site
        ? left.outcome.localeCompare(right.outcome)
        : left.site.localeCompare(right.site),
    );
}

function fail(
  state: AssemblyState,
  reason: AssemblyFailureReason,
  detail: string,
  keys: string[] = [],
): void {
  state.failure ??= { reason, detail, keys };
}

// One scope frame: the names in it and the values behind them, kept together so a clone's rebinding is
// one object rather than two that could drift.
interface Frame {
  readonly scope: ExpressionScope;
  readonly values: ReadonlyMap<string, ExpressionValue>;
}

function transformChildren(
  children: readonly XmlNode[],
  frame: Frame,
  depth: number,
  state: AssemblyState,
): XmlNode[] {
  const structure = matchBlockRegions(children);
  if (structure.failures.length > 0) {
    // Registration refused a template whose blocks do not balance, so reaching one here means the
    // stored bytes were produced by a normalizer that read them differently. Failing loudly is the only
    // honest treatment: the alternative is a document missing a clause nobody will notice.
    fail(
      state,
      "expression-invalid",
      structure.failures[0]?.detail ?? "a block in this template does not balance",
    );
    return [...children];
  }

  const out: XmlNode[] = [];
  const regionByOpen = new Map(structure.regions.map((region) => [region.openIndex, region]));

  for (let index = 0; index < children.length; index += 1) {
    const region = regionByOpen.get(index);
    if (region !== undefined) {
      const marker = region.open.marker;
      if (marker.form === "open") {
        const body = children.slice(region.openIndex + 1, region.closeIndex);
        out.push(...expandBlock(marker.kind, marker.source, body, frame, depth, state));
      }
      index = region.closeIndex;
      continue;
    }
    const child = children[index];
    if (child === undefined) continue;
    out.push(transformUnit(child, frame, depth, state));
  }

  return out;
}

function transformUnit(node: XmlNode, frame: Frame, depth: number, state: AssemblyState): XmlNode {
  const tag = nodeTag(node);
  if (tag === undefined) return node;
  if (tag === "w:p") {
    // Pictures first, and at the RUN level, because a picture REPLACES a run rather than rewriting the
    // text inside one. Doing it before the text pass means the placeholder is already gone by the time
    // the text pass looks, so it cannot also be rendered as an absence marker beside its own drawing.
    const drawn = substituteImagesInParagraph(node, state);
    substituteParagraph(drawn, frame, state);
    return drawn;
  }
  const children = node[tag];
  if (!Array.isArray(children)) return node;
  return { ...node, [tag]: transformChildren(children as XmlNode[], frame, depth, state) };
}

function expandBlock(
  kind: BlockKind,
  source: string,
  body: readonly XmlNode[],
  frame: Frame,
  depth: number,
  state: AssemblyState,
): XmlNode[] {
  if (depth + 1 > EXPRESSION_LIMITS.blockNestingDepth) {
    fail(
      state,
      "expression-invalid",
      `blocks nest deeper than ${EXPRESSION_LIMITS.blockNestingDepth}`,
    );
    return [];
  }

  if (kind === "each") {
    return expandRepeat(source, body, frame, depth, state);
  }

  const effective = rewriteBareKeyCondition(source, frame.scope, kind === "unless");
  const checked = checkExpression(effective, { scope: frame.scope, required: "boolean" });
  if (!checked.ok) {
    tally(state, "condition", "refused");
    fail(
      state,
      "expression-invalid",
      `the condition "${source}" no longer works out against this firm's merge fields: ${checked.failure.detail}`,
    );
    return [];
  }

  const evaluation = evaluate(checked.value, { values: frame.values, budget: state.budget });
  if (evaluation.kind === "refusal") {
    tally(state, "condition", "refused");
    fail(state, "expression-refused", `the condition "${source}" ${evaluation.refusal.detail}`);
    return [];
  }
  // AN UNRESOLVED CONDITION FAILS THE ASSEMBLY, naming the key. Choosing a branch anyway is an
  // invisible error: nobody reads a contract and notices the paragraph that is not there. An author who
  // genuinely means "omit the clause when we have no spouse on file" writes has(...), which is total
  // and never unresolved — the safe reading is available in one word, and the dangerous one cannot be
  // reached by accident.
  if (evaluation.kind === "unresolved") {
    tally(state, "condition", "unresolved");
    fail(
      state,
      "expression-unresolved",
      `the condition "${source}" cannot be worked out because this matter supplies no value for "${evaluation.name}".${reasonSuffix(state, evaluation.name)} Write it as has(${evaluation.name}) if the clause should simply be left out when the value is missing.`,
      [evaluation.name],
    );
    return [];
  }

  tally(state, "condition", "resolved");
  const keep = evaluation.value.kind === "boolean" && evaluation.value.value;
  return keep ? transformChildren(body, frame, depth + 1, state) : [];
}

function expandRepeat(
  source: string,
  body: readonly XmlNode[],
  frame: Frame,
  depth: number,
  state: AssemblyState,
): XmlNode[] {
  const checked = checkExpression(source, { scope: frame.scope, required: "list" });
  if (!checked.ok) {
    tally(state, "repeat", "refused");
    fail(
      state,
      "expression-invalid",
      `the repeating block over "${source}" no longer works out against this firm's merge fields: ${checked.failure.detail}`,
    );
    return [];
  }

  const evaluation = evaluate(checked.value, { values: frame.values, budget: state.budget });
  if (evaluation.kind === "refusal") {
    tally(state, "repeat", "refused");
    fail(
      state,
      "expression-refused",
      `the repeating block over "${source}" ${evaluation.refusal.detail}`,
    );
    return [];
  }
  if (evaluation.kind === "unresolved") {
    tally(state, "repeat", "unresolved");
    fail(
      state,
      "expression-unresolved",
      `the repeating block over "${source}" cannot be worked out because this matter supplies no value for "${evaluation.name}".${reasonSuffix(state, evaluation.name)}`,
      [evaluation.name],
    );
    return [];
  }
  if (evaluation.value.kind !== "list") {
    tally(state, "repeat", "refused");
    fail(state, "expression-refused", `"${source}" is not a list`);
    return [];
  }

  const items = evaluation.value.items;
  if (items.length > EXPRESSION_LIMITS.itemsPerRepeat) {
    tally(state, "repeat", "refused");
    fail(
      state,
      "expression-refused",
      `"${source}" has ${items.length} items and a repeating block walks at most ${EXPRESSION_LIMITS.itemsPerRepeat}.`,
    );
    return [];
  }

  tally(state, "repeat", "resolved");
  const collectionKey = checked.value.node.kind === "name" ? checked.value.node.name : "";
  const out: XmlNode[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] as ListItem;
    state.budget.expandedBlocks += body.length;
    if (state.budget.expandedBlocks > EXPRESSION_LIMITS.expandedBlocksPerAssembly) {
      fail(
        state,
        "expression-refused",
        `this document's repeating blocks expanded past the ${EXPRESSION_LIMITS.expandedBlocksPerAssembly} paragraphs and rows one assembly may produce.`,
      );
      return out;
    }
    // A structural copy per iteration, so the second row cannot share a node with the first. Each clone
    // carries its OWN paragraph and row properties, which is what keeps a repeated list item numbered
    // and a repeated table row banded.
    const clone = body.map(deepCloneNode);
    const itemFrame = frameForItem(frame, collectionKey, item, index, items.length);
    out.push(...transformChildren(clone, itemFrame, depth + 1, state));
    if (state.failure !== undefined) return out;
  }
  return out;
}

function frameForItem(
  frame: Frame,
  collectionKey: string,
  item: ListItem,
  index: number,
  count: number,
): Frame {
  const itemFields = new Map<string, ExpressionType>();
  const values = new Map<string, ExpressionValue>(frame.values);
  for (const [name, value] of item.fields) {
    itemFields.set(name, expressionTypeOfValue(value));
    values.set(`${collectionKey}.${name}`, value);
  }
  values.set("loop.index", { kind: "number", significand: index + 1, scale: 0 });
  values.set("loop.count", { kind: "number", significand: count, scale: 0 });
  values.set("loop.first", { kind: "boolean", value: index === 0 });
  values.set("loop.last", { kind: "boolean", value: index === count - 1 });
  if (item.scalar !== undefined) values.set("loop.value", item.scalar);
  return {
    scope: layerScope(
      frame.scope,
      loopFrame(
        collectionKey,
        itemFields,
        item.scalar === undefined ? undefined : expressionTypeOfValue(item.scalar),
      ),
    ),
    values,
  };
}

function expressionTypeOfValue(value: ExpressionValue): ExpressionType {
  return value.kind;
}

// ---------------------------------------------------------------------------------------------
// Substitution
// ---------------------------------------------------------------------------------------------

// What one placeholder renders to, and how that outcome is recorded. Returning the marker (or the empty
// string) rather than leaving the placeholder in place is deliberate: an unsubstituted `{{key}}` in a
// filed document reads as a software defect to the recipient, while a marker reads as a blank the firm
// still has to fill in — which is what it is.
function renderPlaceholder(body: string, frame: Frame, state: AssemblyState): string {
  if (body.trimStart().startsWith("=")) return renderComputedField(body, frame, state);

  const separator = body.indexOf(":");
  const key = (separator === -1 ? body : body.slice(0, separator)).trim();
  const explicitFormat = separator === -1 ? null : body.slice(separator + 1).trim();
  const entry = lookupDictionaryEntry(key, state.dictionary);
  // A loop-scoped name is not a dictionary key: it comes from the collection the enclosing block is
  // walking, which was read once as a whole.
  const scoped = frame.values.get(key);
  const value = state.context.values.get(key);

  if (entry === undefined && scoped !== undefined) {
    state.substitutions += 1;
    return renderExpressionValue(scoped, explicitFormat ?? defaultFormatFor(scoped), state);
  }

  if (entry === undefined) {
    // A key that is not in the dictionary at all cannot have been resolved, so it is an absence rather
    // than a substitution. Registration refuses these, so reaching one here means the dictionary shrank
    // under a template registered against a wider one.
    recordAbsence(state, key, "placeholder");
    return absenceMarkerFor(key);
  }

  const rendered =
    value === undefined
      ? undefined
      : formatMergeValue(value, explicitFormat ?? entry.defaultFormat, {
          timeZone: state.context.timeZone,
        });

  if (rendered === undefined) {
    if (entry.absence === "fail") {
      state.missingRequired.add(key);
      return absenceMarkerFor(key);
    }
    if (entry.absence === "blank") {
      recordAbsence(state, key, "blank");
      return "";
    }
    recordAbsence(state, key, "placeholder");
    return absenceMarkerFor(key);
  }

  state.substitutions += 1;
  return rendered;
}

// AN UNRESOLVED COMPUTED FIELD RENDERS A VISIBLE PLACEHOLDER, the same bias the absence model takes for
// merge fields: a hole in the output is on the page, where a human reading the draft cannot miss it.
// The asymmetry with a condition is the point — a missing clause is invisible, a missing value is not.
function renderComputedField(body: string, frame: Frame, state: AssemblyState): string {
  const { source, format } = splitComputedField(body);
  const checked = checkExpression(source, {
    scope: frame.scope,
    required: "formattableScalar",
    format,
    legalFormats: (type) => legalFormatsFor(type as MergeValueType),
  });
  if (!checked.ok) {
    tally(state, "computedField", "refused");
    fail(
      state,
      "expression-invalid",
      `the calculation "${source}" no longer works out against this firm's merge fields: ${checked.failure.detail}`,
    );
    return "";
  }

  const evaluation = evaluate(checked.value, { values: frame.values, budget: state.budget });
  if (evaluation.kind === "refusal") {
    tally(state, "computedField", "refused");
    fail(state, "expression-refused", `the calculation "${source}" ${evaluation.refusal.detail}`);
    return "";
  }
  if (evaluation.kind === "unresolved") {
    tally(state, "computedField", "unresolved");
    recordAbsence(state, evaluation.name, "placeholder");
    return absenceMarkerFor(evaluation.name);
  }

  tally(state, "computedField", "resolved");
  state.substitutions += 1;
  return renderExpressionValue(
    evaluation.value,
    format ?? defaultFormatFor(evaluation.value),
    state,
  );
}

// The default rendering is the result TYPE's default — plain for text and number, currency for money,
// long for a date — and the `:format` suffix overrides it, checked statically at registration.
function defaultFormatFor(value: ExpressionValue): string {
  switch (value.kind) {
    case "money":
      return "currency";
    case "date":
      return "long";
    case "boolean":
      return "yesNo";
    default:
      return "plain";
  }
}

function renderExpressionValue(
  value: ExpressionValue,
  format: string,
  state: AssemblyState,
): string {
  const merge = mergeValueOf(value);
  if (merge === undefined) return "";
  return formatMergeValue(merge, format, { timeZone: state.context.timeZone }) ?? "";
}

// An exact decimal renders by MOVING THE DECIMAL POINT on its digits, never by dividing — the same rule
// every formatter in this package obeys, because a division here would silently change the number
// rather than render it.
function mergeValueOf(value: ExpressionValue): MergeValue | undefined {
  switch (value.kind) {
    case "text":
      return { kind: "text", text: value.text };
    case "date":
      return { kind: "date", isoDate: value.isoDate };
    case "money":
      return {
        kind: "money",
        amountMinor: value.amountMinor,
        currencyCode: value.currencyCode,
      };
    case "rate":
      return { kind: "rate", rateE4: value.rateE4, currencyCode: value.currencyCode };
    case "boolean":
      return { kind: "boolean", value: value.value };
    case "number": {
      const negative = value.significand < 0;
      const digits = String(Math.abs(value.significand)).padStart(value.scale + 1, "0");
      const whole = digits.slice(0, digits.length - value.scale);
      const fraction = value.scale === 0 ? "" : `.${digits.slice(digits.length - value.scale)}`;
      return { kind: "text", text: `${negative ? "-" : ""}${whole}${fraction}` };
    }
    case "list":
      return undefined;
  }
}

// ---------------------------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------------------------

// The image value a placeholder body names, or undefined when it names anything else. Only a plain
// merge key can be one: a calculation has no image type to produce and a block marker is not a value, so
// neither is consulted here.
function imageValueFor(
  body: string,
  state: AssemblyState,
): Extract<MergeValue, { kind: "image" }> | undefined {
  if (body.trimStart().startsWith("=")) return undefined;
  const separator = body.indexOf(":");
  const key = (separator === -1 ? body : body.slice(0, separator)).trim();
  const value = state.context.values.get(key);
  return value?.kind === "image" ? value : undefined;
}

// A run rebuilt to carry `text` — the original's properties and any non-text children kept, its text
// leaves collapsed into one. Used for the fragments either side of a picture, so a logo dropped into the
// middle of a line leaves the words around it in the font they were written in.
function runWithText(run: XmlNode, text: string, keepOtherChildren: boolean): XmlNode | undefined {
  const children = childrenOfRun(run);
  const kept = children.filter((child) => {
    const tag = nodeTag(child);
    if (tag === "w:t") return false;
    return keepOtherChildren || tag === "w:rPr";
  });
  if (text === "" && kept.every((child) => nodeTag(child) === "w:rPr")) return undefined;
  const textNode: XmlNode = {
    "w:t": [{ "#text": text }],
    ":@": { "@_xml:space": "preserve" },
  };
  return { ...run, "w:r": text === "" ? kept : [...kept, textNode] };
}

function childrenOfRun(run: XmlNode): XmlNode[] {
  const children = run["w:r"];
  return Array.isArray(children) ? (children as XmlNode[]) : [];
}

function runWithDrawing(run: XmlNode, drawing: XmlNode): XmlNode {
  const properties = childrenOfRun(run).filter((child) => nodeTag(child) === "w:rPr");
  return { ...run, "w:r": [...properties, drawing] };
}

// Put the image into the package and return the drawing that references it, or undefined when the bytes
// are not an image this engine will embed. A refusal here is an ABSENCE rather than a failed assembly:
// the format policy is enforced when the asset is set, so bytes that fail it at this point are an asset
// that changed underneath the office, and a marker where the logo goes says so on the page.
function drawingForImage(
  image: Extract<MergeValue, { kind: "image" }>,
  state: AssemblyState,
): XmlNode | undefined {
  const facts = readImageFacts(image.bytes);
  if (!facts.ok) return undefined;
  const partName = addImagePart(state.parts, "letterhead", facts.value, image.bytes);
  const relationshipId = addImageRelationship(
    state.parts,
    state.currentPart,
    relationshipTargetFor(state.currentPart, partName),
  );
  if (relationshipId === "") return undefined;
  state.drawings += 1;
  return inlineDrawingNode({
    relationshipId,
    widthEmu: image.widthEmu,
    heightEmu: image.heightEmu,
    description: image.description,
    drawingId: state.drawings,
    name: image.description,
  });
}

// Replace every run that carries an image placeholder with the picture it names.
//
// This works on WHOLE RUNS because that is the unit a picture occupies: `w:drawing` is a run-level
// element, and there is no way to put one inside a `w:t`. Normalization already collapsed each
// placeholder into one contiguous run, so the split is exact — the text before the placeholder, the
// drawing, the text after — and a logo placed mid-sentence keeps the words around it intact.
function substituteImagesInParagraph(paragraph: XmlNode, state: AssemblyState): XmlNode {
  const tag = nodeTag(paragraph);
  if (tag === undefined) return paragraph;
  const children = paragraph[tag];
  if (!Array.isArray(children)) return paragraph;

  let rewritten = false;
  const out: XmlNode[] = [];
  for (const child of children as XmlNode[]) {
    const childTag = nodeTag(child);
    if (childTag !== "w:r") {
      // A run can sit inside a hyperlink or a smart-tag wrapper; the walk follows those down rather than
      // ignoring a picture placeholder because of what encloses it.
      if (childTag !== undefined && Array.isArray(child[childTag])) {
        const descended = substituteImagesInParagraph(child, state);
        if (descended !== child) rewritten = true;
        out.push(descended);
        continue;
      }
      out.push(child);
      continue;
    }
    const replacements = splitRunOnImages(child, state);
    if (replacements === undefined) {
      out.push(child);
      continue;
    }
    rewritten = true;
    out.push(...replacements);
  }
  return rewritten ? { ...paragraph, [tag]: out } : paragraph;
}

function splitRunOnImages(run: XmlNode, state: AssemblyState): XmlNode[] | undefined {
  const leaves: TextLeaf[] = [];
  collectTextLeaves(run, leaves);
  if (leaves.length === 0) return undefined;
  const joined = leaves.map((leaf) => leaf.text).join("");
  if (!joined.includes("{{")) return undefined;

  const out: XmlNode[] = [];
  let cursor = 0;
  let found = false;
  PLACEHOLDER_PATTERN.lastIndex = 0;
  for (const match of joined.matchAll(PLACEHOLDER_PATTERN)) {
    const image = imageValueFor(match[1] ?? "", state);
    if (image === undefined) continue;
    const drawing = drawingForImage(image, state);
    if (drawing === undefined) continue;
    // The first fragment keeps whatever else the run held (a tab, a break); later ones carry the run's
    // formatting and nothing more, because that content occurred once and must not be duplicated.
    const before = runWithText(run, joined.slice(cursor, match.index), !found);
    if (before !== undefined) out.push(before);
    out.push(runWithDrawing(run, drawing));
    cursor = match.index + match[0].length;
    found = true;
    state.substitutions += 1;
  }
  if (!found) return undefined;
  const after = runWithText(run, joined.slice(cursor), false);
  if (after !== undefined) out.push(after);
  return out;
}

function substituteParagraph(paragraph: XmlNode, frame: Frame, state: AssemblyState): void {
  const leaves: TextLeaf[] = [];
  collectTextLeaves(paragraph, leaves);
  if (leaves.length === 0) return;

  const joined = leaves.map((leaf) => leaf.text).join("");
  if (!joined.includes("{{")) return;

  const replacementAt = new Map<number, string>();
  const consumed = new Uint8Array(joined.length);
  PLACEHOLDER_PATTERN.lastIndex = 0;
  for (const match of joined.matchAll(PLACEHOLDER_PATTERN)) {
    const start = match.index;
    const body = match[1] ?? "";
    // A block marker that survived to here belongs to a block the walk already handled; leaving it in
    // the text would print `{{#if …}}` into a filed document.
    const replacement =
      parseBlockMarker(body) === undefined ? renderPlaceholder(body, frame, state) : "";
    replacementAt.set(start, replacement);
    consumed.fill(1, start, start + match[0].length);
  }
  if (replacementAt.size === 0) return;

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

// A text assertion cannot see a package no reader will open, which is exactly the class of failure that
// makes a document "damaged" in Word: a declared part that is not there, a required part that went
// missing. The output is checked before it is ever handed back.
export function packageIntegrityViolations(parts: PartMap): string[] {
  const violations: string[] = [];
  for (const required of REQUIRED_PARTS) {
    if (!parts.has(required)) violations.push(`missing required part ${required}`);
  }
  for (const override of contentTypeOverrides(parts)) {
    if (!parts.has(override)) violations.push(`content type declared for absent part ${override}`);
  }
  violations.push(...pictureIntegrityViolations(parts));
  return violations;
}

// The three ways an emitted picture makes a package Word calls damaged, checked over the bytes that are
// about to be handed back:
//
//   1. the part is referenced but not there;
//   2. the part is there but its extension has no declared content type;
//   3. the drawing embeds a relationship id the drawing part does not declare.
//
// Each is invisible to every assertion about the document's TEXT — the words are all correct in a file
// no reader will open — which is the whole reason this reads the package structure instead.
//
// Scoped to image relationships on purpose. A real template carries relationships to fonts, themes,
// styles, and external hyperlinks, and a general "every target must exist" rule would refuse documents
// that are perfectly valid; what this pass EMITS is pictures, so pictures are what it vouches for.
function pictureIntegrityViolations(parts: PartMap): string[] {
  const violations: string[] = [];
  const declaredExtensions = new Set(
    [
      ...(readPartText(parts, CONTENT_TYPES_PART) ?? "").matchAll(/Extension\s*=\s*"([^"]+)"/g),
    ].flatMap((match) => (match[1] === undefined ? [] : [match[1].toLowerCase()])),
  );

  for (const partName of contentPartNames(parts.keys())) {
    const xml = readPartText(parts, partName);
    if (xml === undefined) continue;
    const relationships = declaredRelationships(parts, partName);
    for (const embedded of embeddedRelationshipIds(xml)) {
      const relationship = relationships.get(embedded);
      if (relationship === undefined) {
        violations.push(`${partName} embeds ${embedded}, which it does not declare`);
        continue;
      }
      if (!relationship.external && !parts.has(relationship.target)) {
        violations.push(
          `${partName} embeds ${embedded}, whose part ${relationship.target} is absent`,
        );
        continue;
      }
      const extension = relationship.target.slice(relationship.target.lastIndexOf(".") + 1);
      if (!relationship.external && !declaredExtensions.has(extension.toLowerCase())) {
        violations.push(`no content type is declared for .${extension} parts`);
      }
    }
  }
  return violations;
}

export interface AssembleOptions {
  // The dictionary the document's expressions are re-checked against — the one the firm has TODAY, not
  // the one it had when the template registered. That difference is the point: a template bound to a
  // custom field archived three months later must fail naming the key.
  readonly dictionary?: readonly DictionaryEntry[];
}

export interface DocumentAssemblyPort {
  assemble(
    templateBytes: Uint8Array,
    context: MergeContext,
    options?: AssembleOptions,
  ): AssemblyResult;
}

export function assemble(
  templateBytes: Uint8Array,
  context: MergeContext,
  options: AssembleOptions = {},
): AssemblyResult {
  const read = readPackage(templateBytes);
  if (!read.ok) {
    return {
      ok: false,
      reason: "unreadable-template",
      detail: read.detail,
      keys: [],
      expressions: [],
    };
  }

  const parts: PartMap = new Map(read.value);
  const state: AssemblyState = {
    context,
    dictionary: options.dictionary,
    baseScope: expressionScopeFor(options.dictionary),
    baseValues: expressionValuesOf(context),
    budget: createEvaluationBudget(),
    absences: new Map(),
    missingRequired: new Set(),
    tallies: new Map(),
    parts,
    currentPart: "",
    drawings: 0,
    substitutions: 0,
    failure: undefined,
  };
  const rootFrame: Frame = { scope: state.baseScope, values: state.baseValues };

  // The part list is snapshotted before the walk: emitting a picture ADDS parts to the package, and a
  // live iteration over the map's keys would then walk the media it just wrote.
  for (const partName of contentPartNames([...parts.keys()])) {
    const xml = readPartText(parts, partName);
    if (xml === undefined) continue;
    state.currentPart = partName;
    let nodes: XmlNode[];
    try {
      nodes = parseXml(xml);
    } catch {
      return {
        ok: false,
        reason: "unreadable-template",
        detail: `${partName} is not well-formed XML`,
        keys: [],
        expressions: talliesOf(state),
      };
    }
    const transformed = transformChildren(nodes, rootFrame, 0, state);
    if (state.failure !== undefined) {
      return {
        ok: false,
        reason: state.failure.reason,
        detail: `${state.failure.detail} (in ${partName})`,
        keys: state.failure.keys,
        expressions: talliesOf(state),
      };
    }
    writePartText(parts, partName, buildXml(transformed));
  }

  if (state.missingRequired.size > 0) {
    const keys = [...state.missingRequired].sort();
    return {
      ok: false,
      reason: "missing-required-field",
      detail: `the matter supplies no value for ${keys.length} required merge field${keys.length === 1 ? "" : "s"}`,
      keys,
      expressions: talliesOf(state),
    };
  }

  const violations = packageIntegrityViolations(parts);
  if (violations.length > 0) {
    return {
      ok: false,
      reason: "package-integrity",
      detail: violations.join("; "),
      keys: [],
      expressions: talliesOf(state),
    };
  }

  return {
    ok: true,
    bytes: writePackage(parts),
    absences: [...state.absences.values()].sort((left, right) => left.key.localeCompare(right.key)),
    substitutions: state.substitutions,
    expressions: talliesOf(state),
  };
}

export function createDocumentAssemblyPort(): DocumentAssemblyPort {
  return { assemble };
}

// Re-exported so a caller that only imports the assembly path can still describe what a checked
// expression reads without reaching into the language's own folder.
export type { CheckedExpression, ExpressionValue, ListItem, MergeValueType };
export { markerOfUnit };
