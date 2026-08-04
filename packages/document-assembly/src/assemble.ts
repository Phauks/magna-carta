import { lookupDictionaryEntry } from "./dictionary.ts";
import { formatMergeValue } from "./format.ts";
import {
  contentTypeOverrides,
  readPackage,
  readPartText,
  writePackage,
  writePartText,
  type PartMap,
} from "./ooxml/package.ts";
import { contentPartNames, REQUIRED_PARTS } from "./ooxml/parts.ts";
import { attributesOf, buildXml, nodeTag, parseXml, textOf, type XmlNode } from "./ooxml/xml.ts";
import type { MergeContext } from "./types.ts";

// Substitution is deliberately the small half of this package. Because normalization already rewrote
// every placeholder into a single contiguous run and recorded the manifest, an assembly is a walk over
// known runs — no run reassembly, no delimiter hunting, no re-derivation of the hard part. That is what
// makes the per-assembly path cheap enough to stay in a Worker and makes output reproducible: the same
// template version plus the same merge context always yields the same bytes.
//
// The pass is purely subtractive and substitutive. It never adds a part, a relationship, a script, or an
// external reference — whatever active content a template could have carried was stripped and re-verified
// at registration, and this pass has no mechanism to reintroduce any.

export type AssemblyFailureReason =
  | "unreadable-template"
  | "missing-required-field"
  | "package-integrity";

export interface AssemblyAbsence {
  readonly key: string;
  // What the document shows where the value would have been. Never the value — there is none.
  readonly rendered: "blank" | "placeholder";
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
    }
  | {
      readonly ok: false;
      readonly reason: AssemblyFailureReason;
      readonly detail: string;
      // For missing-required-field: which keys. A merge failure reports WHICH KEY failed, never what it
      // held.
      readonly keys: readonly string[];
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

function forEachParagraph(nodes: XmlNode[], visit: (paragraph: XmlNode) => void): void {
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (tag === undefined) continue;
    if (tag === "w:p") {
      visit(node);
      continue;
    }
    const children = node[tag];
    if (Array.isArray(children)) forEachParagraph(children as XmlNode[], visit);
  }
}

interface SubstitutionState {
  readonly context: MergeContext;
  readonly absences: Map<string, AssemblyAbsence>;
  readonly missingRequired: Set<string>;
  substitutions: number;
}

// What one placeholder renders to, and how that outcome is recorded. Returning the marker (or the empty
// string) rather than leaving the placeholder in place is deliberate: an unsubstituted `{{key}}` in a
// filed document reads as a software defect to the recipient, while a marker reads as a blank the firm
// still has to fill in — which is what it is.
function renderPlaceholder(body: string, state: SubstitutionState): string {
  const separator = body.indexOf(":");
  const key = (separator === -1 ? body : body.slice(0, separator)).trim();
  const explicitFormat = separator === -1 ? null : body.slice(separator + 1).trim();
  const entry = lookupDictionaryEntry(key);
  const value = state.context.values.get(key);

  if (entry === undefined) {
    // A key that is not in the dictionary at all cannot have been resolved, so it is an absence rather
    // than a substitution. Registration refuses these, so reaching one here means the dictionary shrank
    // under a template registered against a wider one.
    state.absences.set(key, { key, rendered: "placeholder" });
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
      state.absences.set(key, { key, rendered: "blank" });
      return "";
    }
    state.absences.set(key, { key, rendered: "placeholder" });
    return absenceMarkerFor(key);
  }

  state.substitutions += 1;
  return rendered;
}

function substituteParagraph(paragraph: XmlNode, state: SubstitutionState): void {
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
    replacementAt.set(start, renderPlaceholder(match[1] ?? "", state));
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
  return violations;
}

export interface DocumentAssemblyPort {
  assemble(templateBytes: Uint8Array, context: MergeContext): AssemblyResult;
}

export function assemble(templateBytes: Uint8Array, context: MergeContext): AssemblyResult {
  const read = readPackage(templateBytes);
  if (!read.ok) {
    return { ok: false, reason: "unreadable-template", detail: read.detail, keys: [] };
  }

  const parts: PartMap = new Map(read.value);
  const state: SubstitutionState = {
    context,
    absences: new Map(),
    missingRequired: new Set(),
    substitutions: 0,
  };

  for (const partName of contentPartNames(parts.keys())) {
    const xml = readPartText(parts, partName);
    if (xml === undefined) continue;
    let nodes: XmlNode[];
    try {
      nodes = parseXml(xml);
    } catch {
      return {
        ok: false,
        reason: "unreadable-template",
        detail: `${partName} is not well-formed XML`,
        keys: [],
      };
    }
    forEachParagraph(nodes, (paragraph) => substituteParagraph(paragraph, state));
    writePartText(parts, partName, buildXml(nodes));
  }

  if (state.missingRequired.size > 0) {
    const keys = [...state.missingRequired].sort();
    return {
      ok: false,
      reason: "missing-required-field",
      detail: `the matter supplies no value for ${keys.length} required merge field${keys.length === 1 ? "" : "s"}`,
      keys,
    };
  }

  const violations = packageIntegrityViolations(parts);
  if (violations.length > 0) {
    return {
      ok: false,
      reason: "package-integrity",
      detail: violations.join("; "),
      keys: [],
    };
  }

  return {
    ok: true,
    bytes: writePackage(parts),
    absences: [...state.absences.values()].sort((left, right) => left.key.localeCompare(right.key)),
    substitutions: state.substitutions,
  };
}

export function createDocumentAssemblyPort(): DocumentAssemblyPort {
  return { assemble };
}
