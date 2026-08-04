import { strToU8, zipSync } from "fflate";
import { safeUnzip } from "../guards.ts";
import type { ScrubOptions } from "../options.ts";
import {
  attributesOf,
  CELL_REVISION_TAGS,
  cellIsDeleted,
  COMMENT_REF_TAGS,
  CONTENT_PART_PATTERN,
  PROP_CHANGE_TAGS,
  RANGE_MARKER_TAGS,
  REMOVE_TAGS,
  revisionSaveIdentifierAttributeNames,
  rowIsDeleted,
  runIsHidden,
  UNWRAP_TAGS,
} from "./walk.ts";
import { buildXml, nodeTag, parseXml, type XmlNode } from "./xml.ts";
import {
  APP_PART,
  CONTENT_TYPES_PART,
  CORE_PART,
  COMMENT_PART_PATTERN,
  CUSTOM_PROPERTIES_PART,
  CUSTOM_XML_PART_PATTERN,
  EDIT_HISTORY_TAGS,
  RELS_PART_PATTERN,
  SETTINGS_PART,
  SETTINGS_TAGS_IDENTIFYING,
  SETTINGS_TAGS_CUSTOM,
  THUMBNAIL_PART_PATTERN,
  WORD_PART_PATTERN,
} from "./parts.ts";

const EMPTY_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>`;
const EMPTY_APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>`;

// Relationship types dropped with the identifying metadata. The elements that reference them live in
// word/settings.xml, but the value that leaks — a template or mail-merge data-source location, often
// a full network path naming the firm, the client, or the matter — is the relationship Target.
const IDENTIFYING_RELATIONSHIP_TYPES = ["/attachedTemplate", "/mailMergeSource"];

// The transforms applied to a word-processing content part: remove comment references, hidden runs,
// deleted text (REMOVE_TAGS), formatting-change records (PROP_CHANGE_TAGS) and the rest of the
// revision vocabulary, unwrap inserted/moved-in text (UNWRAP_TAGS), and strip revision save
// identifiers. Each flag maps to one scrub option, so a user who keeps a category keeps its markup.
export interface DocumentTransform {
  readonly comments: boolean;
  readonly hiddenContent: boolean;
  readonly trackedChanges: boolean;
  readonly editHistory: boolean;
}

function withoutRevisionSaveIdentifiers(node: XmlNode): XmlNode {
  const names = revisionSaveIdentifierAttributeNames(node);
  if (names.length === 0) return node;
  const attributes = { ...attributesOf(node) };
  for (const name of names) delete attributes[name];
  if (Object.keys(attributes).length === 0) {
    const { ":@": _dropped, ...rest } = node;
    return rest;
  }
  return { ...node, ":@": attributes };
}

export function transformDocumentNodes(nodes: XmlNode[], transform: DocumentTransform): XmlNode[] {
  const out: XmlNode[] = [];
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (tag === undefined) {
      out.push(node);
      continue;
    }
    if (transform.trackedChanges) {
      // Order matters: a removal must be decided BEFORE an unwrap recurses, or a deletion nested in
      // an insertion is hoisted out of the wrapper that was about to carry it away.
      if (REMOVE_TAGS.has(tag)) continue;
      if (RANGE_MARKER_TAGS.has(tag)) continue;
      if (PROP_CHANGE_TAGS.has(tag)) continue;
      if (CELL_REVISION_TAGS.has(tag)) continue;
      // Accepting a tracked row/cell deletion removes the row or cell itself, not just its marker.
      if (tag === "w:tr" && rowIsDeleted(node)) continue;
      if (tag === "w:tc" && cellIsDeleted(node)) continue;
    }
    if (transform.editHistory && EDIT_HISTORY_TAGS.has(tag)) continue;
    if (transform.comments && COMMENT_REF_TAGS.has(tag)) continue;
    if (transform.hiddenContent && tag === "w:r" && runIsHidden(node)) continue;
    if (transform.trackedChanges && UNWRAP_TAGS.has(tag)) {
      const children = node[tag];
      if (Array.isArray(children)) {
        out.push(...transformDocumentNodes(children as XmlNode[], transform));
      }
      continue;
    }
    const kept = transform.editHistory ? withoutRevisionSaveIdentifiers(node) : node;
    const children = kept[tag];
    if (Array.isArray(children)) {
      out.push({ ...kept, [tag]: transformDocumentNodes(children as XmlNode[], transform) });
    } else {
      out.push(kept);
    }
  }
  return out;
}

// Drop every element whose tag is in `tags`, at any depth.
function removeTags(nodes: XmlNode[], tags: ReadonlySet<string>): XmlNode[] {
  const out: XmlNode[] = [];
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (tag === undefined) {
      out.push(node);
      continue;
    }
    if (tags.has(tag)) continue;
    const children = node[tag];
    if (Array.isArray(children)) {
      out.push({ ...node, [tag]: removeTags(children as XmlNode[], tags) });
    } else {
      out.push(node);
    }
  }
  return out;
}

// Resolve a relationship Target against the directory of the part the .rels file describes, so a
// relationship can be matched to the part it actually points at.
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

// Rewrite a .rels part, dropping relationships that point at a part this scrub removed, plus the
// relationship types whose Target is itself the disclosure.
//
// Matching is by RESOLVED TARGET and relationship Type, never by target filename: an external
// hyperlink whose URL happens to end in a part name we drop must survive, and removing it would
// leave a dangling reference that makes the document unopenable.
function filterRelationships(
  relsXml: string,
  base: string,
  isDroppedPart: (name: string) => boolean,
  droppedTypes: readonly string[],
): string {
  const filter = (list: XmlNode[]): XmlNode[] =>
    list
      .filter((node) => {
        if (nodeTag(node) !== "Relationship") return true;
        const attributes = attributesOf(node);
        const type = typeof attributes["@_Type"] === "string" ? attributes["@_Type"] : "";
        if (droppedTypes.some((dropped) => type.endsWith(dropped))) return false;
        const rawTarget = attributes["@_Target"];
        const target = typeof rawTarget === "string" ? rawTarget : "";
        if (attributes["@_TargetMode"] === "External") return true;
        return !isDroppedPart(resolvePartName(base, target));
      })
      .map((node) => {
        const tag = nodeTag(node);
        if (tag !== undefined && Array.isArray(node[tag])) {
          return { ...node, [tag]: filter(node[tag] as XmlNode[]) };
        }
        return node;
      });
  return buildXml(filter(parseXml(relsXml)));
}

// Rewrite [Content_Types].xml, dropping the Override of every part this scrub removed. A package
// that declares a content type for a part it no longer contains is invalid, and strict validators
// (court e-filing among them) reject it.
function filterContentTypes(xml: string, isDroppedPart: (name: string) => boolean): string {
  const filter = (list: XmlNode[]): XmlNode[] =>
    list
      .filter((node) => {
        if (nodeTag(node) !== "Override") return true;
        const rawPartName = attributesOf(node)["@_PartName"];
        const partName = typeof rawPartName === "string" ? rawPartName : "";
        return !isDroppedPart(partName.replace(/^\//, ""));
      })
      .map((node) => {
        const tag = nodeTag(node);
        if (tag !== undefined && Array.isArray(node[tag])) {
          return { ...node, [tag]: filter(node[tag] as XmlNode[]) };
        }
        return node;
      });
  return buildXml(filter(parseXml(xml)));
}

// The parts removed outright, by option. Each is a whole class of privileged content that no amount
// of editing the XML inside it would make safe to send:
//   - docProps/custom.xml   custom document properties (matter numbers, client codes)
//   - customXml/*           arbitrary embedded data, typically a document-management system's
//                           client/matter record travelling inside the file
//   - docProps/thumbnail.*  a rendered image of page one, which still shows the text and markup the
//                           XML scrub just removed
//   - word/comments*.xml,   reviewer comments, their authors, and their timestamps
//     word/people.xml
function droppedParts(entryNames: readonly string[], options: ScrubOptions): Set<string> {
  const dropped = new Set<string>();
  for (const name of entryNames) {
    if (options.customProperties && name === CUSTOM_PROPERTIES_PART) dropped.add(name);
    if (options.customProperties && CUSTOM_XML_PART_PATTERN.test(name)) dropped.add(name);
    if (options.identifyingMetadata && THUMBNAIL_PART_PATTERN.test(name)) dropped.add(name);
    if (options.comments && COMMENT_PART_PATTERN.test(name)) dropped.add(name);
  }
  return dropped;
}

// Rewrite word/settings.xml: remove the document variables, the mail-merge configuration (its data
// source is frequently a network path), the attached-template reference, and the revision save
// identifier list.
function scrubSettings(xml: string, options: ScrubOptions): string {
  const tags = new Set<string>();
  if (options.identifyingMetadata) for (const tag of SETTINGS_TAGS_IDENTIFYING) tags.add(tag);
  if (options.customProperties) for (const tag of SETTINGS_TAGS_CUSTOM) tags.add(tag);
  let nodes = removeTags(parseXml(xml), tags);
  if (options.identifyingMetadata) {
    nodes = transformDocumentNodes(nodes, {
      comments: false,
      hiddenContent: false,
      trackedChanges: false,
      editHistory: true,
    });
  }
  return buildXml(nodes);
}

export function scrubDocx(bytes: Uint8Array, options: ScrubOptions): Uint8Array {
  const entries = safeUnzip(bytes);
  const dropped = droppedParts(Object.keys(entries), options);
  const isDroppedPart = (name: string): boolean => dropped.has(name);
  const droppedTypes = options.identifyingMetadata ? IDENTIFYING_RELATIONSHIP_TYPES : [];
  const decoder = new TextDecoder();
  const out: Record<string, Uint8Array> = {};

  for (const [name, content] of Object.entries(entries)) {
    if (dropped.has(name)) continue;

    if (options.identifyingMetadata && name === CORE_PART) {
      out[name] = strToU8(EMPTY_CORE);
      continue;
    }
    if (options.identifyingMetadata && name === APP_PART) {
      out[name] = strToU8(EMPTY_APP);
      continue;
    }
    if (name === CONTENT_TYPES_PART && dropped.size > 0) {
      out[name] = strToU8(filterContentTypes(decoder.decode(content), isDroppedPart));
      continue;
    }
    if (RELS_PART_PATTERN.test(name) && (dropped.size > 0 || droppedTypes.length > 0)) {
      out[name] = strToU8(
        filterRelationships(
          decoder.decode(content),
          relationshipBase(name),
          isDroppedPart,
          droppedTypes,
        ),
      );
      continue;
    }
    if (name === SETTINGS_PART && (options.identifyingMetadata || options.customProperties)) {
      out[name] = strToU8(scrubSettings(decoder.decode(content), options));
      continue;
    }
    if (
      CONTENT_PART_PATTERN.test(name) &&
      (options.comments ||
        options.hiddenContent ||
        options.trackedChanges ||
        options.identifyingMetadata)
    ) {
      const transformed = transformDocumentNodes(parseXml(decoder.decode(content)), {
        comments: options.comments,
        hiddenContent: options.hiddenContent,
        trackedChanges: options.trackedChanges,
        editHistory: options.identifyingMetadata,
      });
      out[name] = strToU8(buildXml(transformed));
      continue;
    }
    // Every other word-processing part (styles, numbering, fonts, web settings) carries the same
    // revision save identifiers, so they are swept there too — otherwise the edit history survives
    // in a part nobody looks at.
    if (options.identifyingMetadata && WORD_PART_PATTERN.test(name)) {
      const transformed = transformDocumentNodes(parseXml(decoder.decode(content)), {
        comments: false,
        hiddenContent: false,
        trackedChanges: false,
        editHistory: true,
      });
      out[name] = strToU8(buildXml(transformed));
      continue;
    }
    out[name] = content;
  }

  return zipSync(out);
}
