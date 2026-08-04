import {
  contentTypeOverrides,
  readPartText,
  writePartText,
  type PartMap,
} from "./ooxml/package.ts";
import { CONTENT_TYPES_PART, RELS_PART_PATTERN } from "./ooxml/parts.ts";
import { attributesOf, buildXml, nodeTag, parseXml, type XmlNode } from "./ooxml/xml.ts";

// Macro removal is a security boundary, not a tidy-up. A template is executed against privileged firm
// and client data on the firm's behalf, so a template package must carry no code — and a firm migrating
// from an older system has macro-bearing templates it will ask us to accept. The resolution is to accept
// the upload and STRIP it, then re-verify the stripped package before it is allowed to register: a
// template version whose bytes still show any macro residue is refused outright rather than stored.
//
// Detection is driven by the CONTENT-TYPES MAP and the RELATIONSHIP TYPES, never by file name alone. A
// package that puts its VBA project at word/embeddings/settings.bin and declares it with an Override
// carrying the vbaProject content type is exactly as macro-bearing as one that uses the conventional
// name, and a name-only check would pass it through untouched. The conventional names are checked too,
// as a third net rather than the primary one.

// The content types that ARE a macro payload: the VBA project itself, the Word-side VBA data part, and
// the project's digital signature.
const MACRO_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "application/vnd.ms-office.vbaproject",
  "application/vnd.ms-office.vbaprojectsignature",
  "application/vnd.ms-word.vbadata+xml",
]);

// The relationship types that REACH a macro payload. Matched on the type suffix because the namespace
// prefix differs between the standard and Microsoft extension namespaces.
const MACRO_RELATIONSHIP_TYPE_SUFFIXES: readonly string[] = [
  "/vbaproject",
  "/wordvbadata",
  "/vbaprojectsignature",
];

// The conventional names, as a third net under the content-type and relationship checks.
const CONVENTIONAL_MACRO_PART_PATTERN = /(^|\/)vba(project(signature)?\.bin|data\.xml)$/i;

// The main-document content types, macro-enabled on the left and macro-free on the right. A `.docm`
// declares its main part macro-enabled even after its VBA project is removed, and a package that still
// says "macro-enabled" is one Word will keep offering to run macros from — so the declaration is
// rewritten as part of the strip, and its survival is treated as residue.
const MACRO_ENABLED_MAIN_CONTENT_TYPES: ReadonlyMap<string, string> = new Map([
  [
    "application/vnd.ms-word.document.macroenabled.main+xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  ],
  [
    "application/vnd.ms-word.template.macroenabledtemplate.main+xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml",
  ],
]);

function extensionOf(partName: string): string {
  const dot = partName.lastIndexOf(".");
  return dot === -1 ? "" : partName.slice(dot + 1).toLowerCase();
}

// Resolve a relationship Target against the directory of the part the .rels file describes, so a
// relationship can be matched to the part it actually points at rather than to a filename that merely
// looks the same.
function resolvePartName(base: string, target: string): string {
  const raw = target.startsWith("/") ? target.slice(1) : base + target;
  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

// The directory a .rels file's targets are relative to: "word/_rels/document.xml.rels" -> "word/",
// "_rels/.rels" -> "" (the package root).
function relationshipBase(relsPartName: string): string {
  return relsPartName.replace(/_rels\/[^/]*\.rels$/, "");
}

interface RelationshipRecord {
  readonly relsPart: string;
  readonly type: string;
  readonly resolvedTarget: string;
  readonly external: boolean;
}

function relationshipsIn(parts: PartMap): RelationshipRecord[] {
  const records: RelationshipRecord[] = [];
  for (const name of parts.keys()) {
    if (!RELS_PART_PATTERN.test(name)) continue;
    const xml = readPartText(parts, name) ?? "";
    const base = relationshipBase(name);
    const walk = (nodes: XmlNode[]): void => {
      for (const node of nodes) {
        const tag = nodeTag(node);
        if (tag === undefined) continue;
        if (tag === "Relationship") {
          const attributes = attributesOf(node);
          const type = typeof attributes["@_Type"] === "string" ? attributes["@_Type"] : "";
          const target = typeof attributes["@_Target"] === "string" ? attributes["@_Target"] : "";
          records.push({
            relsPart: name,
            type,
            resolvedTarget: resolvePartName(base, target),
            external: attributes["@_TargetMode"] === "External",
          });
          continue;
        }
        const children = node[tag];
        if (Array.isArray(children)) walk(children as XmlNode[]);
      }
    };
    walk(parseXml(xml));
  }
  return records;
}

function isMacroRelationshipType(type: string): boolean {
  const lowered = type.toLowerCase();
  return MACRO_RELATIONSHIP_TYPE_SUFFIXES.some((suffix) => lowered.endsWith(suffix));
}

// Every part name the content-types map declares with a macro content type, whether through a per-part
// Override or through a Default on the part's extension.
function macroPartsFromContentTypes(parts: PartMap): Set<string> {
  const found = new Set<string>();
  const xml = readPartText(parts, CONTENT_TYPES_PART) ?? "";
  const macroExtensions = new Set<string>();
  const walk = (nodes: XmlNode[]): void => {
    for (const node of nodes) {
      const tag = nodeTag(node);
      if (tag === undefined) continue;
      const attributes = attributesOf(node);
      const contentType =
        typeof attributes["@_ContentType"] === "string"
          ? attributes["@_ContentType"].toLowerCase()
          : "";
      if (tag === "Override" && MACRO_CONTENT_TYPES.has(contentType)) {
        const partName = attributes["@_PartName"];
        if (typeof partName === "string") found.add(partName.replace(/^\//, ""));
      }
      if (tag === "Default" && MACRO_CONTENT_TYPES.has(contentType)) {
        const extension = attributes["@_Extension"];
        if (typeof extension === "string") macroExtensions.add(extension.toLowerCase());
      }
      const children = node[tag];
      if (Array.isArray(children)) walk(children as XmlNode[]);
    }
  };
  walk(parseXml(xml));
  if (macroExtensions.size > 0) {
    for (const name of parts.keys()) {
      if (macroExtensions.has(extensionOf(name))) found.add(name);
    }
  }
  return found;
}

// Every part in the package that is a macro payload, by any of the three nets.
export function detectMacroParts(parts: PartMap): Set<string> {
  const found = macroPartsFromContentTypes(parts);
  for (const relationship of relationshipsIn(parts)) {
    if (!relationship.external && isMacroRelationshipType(relationship.type)) {
      found.add(relationship.resolvedTarget);
    }
  }
  for (const name of parts.keys()) {
    if (CONVENTIONAL_MACRO_PART_PATTERN.test(name)) found.add(name);
  }
  // Only names the package actually carries; a declared-but-absent Override is handled by the
  // content-types rewrite below, not by pretending a part exists.
  return new Set([...found].filter((name) => parts.has(name)));
}

// Rewrite [Content_Types].xml: drop the Override of every removed part, drop a Default whose extension
// no longer has any part left to describe, and demote a macro-enabled main-document declaration to its
// macro-free equivalent. A package that declares a content type for a part it no longer contains is
// invalid, and strict validators reject it.
function rewriteContentTypes(parts: PartMap, removed: ReadonlySet<string>): void {
  const xml = readPartText(parts, CONTENT_TYPES_PART);
  if (xml === undefined) return;
  const survivingExtensions = new Set<string>();
  for (const name of parts.keys()) {
    if (!removed.has(name)) survivingExtensions.add(extensionOf(name));
  }

  const rewrite = (nodes: XmlNode[]): XmlNode[] =>
    nodes
      .filter((node) => {
        const tag = nodeTag(node);
        const attributes = attributesOf(node);
        const contentType =
          typeof attributes["@_ContentType"] === "string"
            ? attributes["@_ContentType"].toLowerCase()
            : "";
        if (tag === "Override") {
          const partName = attributes["@_PartName"];
          const resolved = typeof partName === "string" ? partName.replace(/^\//, "") : "";
          return !removed.has(resolved) && !MACRO_CONTENT_TYPES.has(contentType);
        }
        if (tag === "Default" && MACRO_CONTENT_TYPES.has(contentType)) {
          const extension = attributes["@_Extension"];
          // A Default the package still needs for a surviving part (printer settings and embedded OLE
          // objects are also ".bin") stays; one nothing uses any more goes with the macro parts.
          return typeof extension === "string" && survivingExtensions.has(extension.toLowerCase());
        }
        return true;
      })
      .map((node) => {
        const tag = nodeTag(node);
        if (tag === undefined) return node;
        let mapped = node;
        if (tag === "Override") {
          const attributes = attributesOf(node);
          const contentType =
            typeof attributes["@_ContentType"] === "string"
              ? attributes["@_ContentType"].toLowerCase()
              : "";
          const macroFree = MACRO_ENABLED_MAIN_CONTENT_TYPES.get(contentType);
          if (macroFree !== undefined) {
            mapped = { ...node, ":@": { ...attributes, "@_ContentType": macroFree } };
          }
        }
        const children = mapped[tag];
        if (Array.isArray(children)) {
          return { ...mapped, [tag]: rewrite(children as XmlNode[]) };
        }
        return mapped;
      });

  writePartText(parts, CONTENT_TYPES_PART, buildXml(rewrite(parseXml(xml))));
}

// Rewrite every .rels part, dropping relationships that resolve to a removed part and every relationship
// whose TYPE reaches a macro payload. Matching is by resolved target and by type, never by target
// filename: an external hyperlink whose URL happens to end in a removed part's name must survive, and
// removing it would leave a dangling reference that makes a reader declare the document damaged.
function rewriteRelationships(parts: PartMap, removed: ReadonlySet<string>): void {
  for (const name of [...parts.keys()]) {
    if (!RELS_PART_PATTERN.test(name)) continue;
    const xml = readPartText(parts, name);
    if (xml === undefined) continue;
    const base = relationshipBase(name);
    const rewrite = (nodes: XmlNode[]): XmlNode[] =>
      nodes
        .filter((node) => {
          if (nodeTag(node) !== "Relationship") return true;
          const attributes = attributesOf(node);
          const type = typeof attributes["@_Type"] === "string" ? attributes["@_Type"] : "";
          if (isMacroRelationshipType(type)) return false;
          if (attributes["@_TargetMode"] === "External") return true;
          const target = typeof attributes["@_Target"] === "string" ? attributes["@_Target"] : "";
          return !removed.has(resolvePartName(base, target));
        })
        .map((node) => {
          const tag = nodeTag(node);
          if (tag !== undefined && Array.isArray(node[tag])) {
            return { ...node, [tag]: rewrite(node[tag] as XmlNode[]) };
          }
          return node;
        });
    writePartText(parts, name, buildXml(rewrite(parseXml(xml))));
  }
}

export interface MacroStripResult {
  readonly parts: PartMap;
  readonly removedParts: readonly string[];
}

// Remove every macro payload from a package and repair the declarations that referenced it. The input
// map is not mutated; the caller re-emits the returned map and then re-verifies it with macroResidue
// before anything is stored.
export function stripMacros(parts: PartMap): MacroStripResult {
  const stripped: PartMap = new Map(parts);
  const removed = detectMacroParts(stripped);
  for (const name of removed) stripped.delete(name);
  // The declarations are repaired even when no part was removed: a package can declare a macro-enabled
  // main document with its VBA project already gone, and that declaration is itself residue.
  rewriteContentTypes(stripped, removed);
  rewriteRelationships(stripped, removed);
  return { parts: stripped, removedParts: [...removed].sort() };
}

export interface MacroResidueFinding {
  readonly kind: "part" | "content-type" | "relationship" | "macro-enabled-declaration";
  readonly detail: string;
}

// The verification gate. Run over the STRIPPED package's re-emitted bytes; a non-empty result means the
// stripper could not make the package clean and the template version must not register. This is
// deliberately a separate, independent scan rather than a boolean the stripper returns: the stripper
// asserting its own success is the failure mode this exists to catch.
export function macroResidue(parts: PartMap): MacroResidueFinding[] {
  const findings: MacroResidueFinding[] = [];
  for (const name of detectMacroParts(parts)) {
    findings.push({ kind: "part", detail: name });
  }
  const contentTypes = readPartText(parts, CONTENT_TYPES_PART) ?? "";
  for (const match of contentTypes.matchAll(/ContentType\s*=\s*"([^"]+)"/g)) {
    const contentType = (match[1] ?? "").toLowerCase();
    if (MACRO_CONTENT_TYPES.has(contentType)) {
      findings.push({ kind: "content-type", detail: contentType });
    }
    if (MACRO_ENABLED_MAIN_CONTENT_TYPES.has(contentType)) {
      findings.push({ kind: "macro-enabled-declaration", detail: contentType });
    }
  }
  for (const relationship of relationshipsIn(parts)) {
    if (isMacroRelationshipType(relationship.type)) {
      findings.push({ kind: "relationship", detail: relationship.type });
    }
  }
  // An Override left behind for a part the package no longer carries is not macro residue, but it does
  // make the package invalid, so it is surfaced through the same gate rather than a second one.
  for (const override of contentTypeOverrides(parts)) {
    if (!parts.has(override)) {
      findings.push({ kind: "content-type", detail: `Override for absent part ${override}` });
    }
  }
  return findings;
}
