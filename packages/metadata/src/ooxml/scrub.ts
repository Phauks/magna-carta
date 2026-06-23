import { strToU8, zipSync } from "fflate";
import { safeUnzip } from "../guards.ts";
import type { ScrubOptions } from "../options.ts";
import {
  COMMENT_REF_TAGS,
  CONTENT_PART_PATTERN,
  PROP_CHANGE_TAGS,
  REMOVE_TAGS,
  runIsHidden,
  UNWRAP_TAGS,
} from "./walk.ts";
import { buildXml, nodeTag, parseXml, type XmlNode } from "./xml.ts";

const EMPTY_CORE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>`;
const EMPTY_APP = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>`;

const COMMENT_PART_PATTERN = /^word\/(comments|commentsExtended|commentsIds|people)\.xml$/;

// The transforms applied to word/document.xml: remove comment references, hidden runs, deleted
// text (REMOVE_TAGS), formatting-change records (PROP_CHANGE_TAGS), and unwrap inserted/moved-in
// text (UNWRAP_TAGS) when trackedChanges is enabled.
export interface DocumentTransform {
  readonly comments: boolean;
  readonly hiddenContent: boolean;
  readonly trackedChanges: boolean;
}

export function transformDocumentNodes(nodes: XmlNode[], t: DocumentTransform): XmlNode[] {
  const out: XmlNode[] = [];
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (tag === undefined) {
      out.push(node);
      continue;
    }
    if (t.trackedChanges && REMOVE_TAGS.has(tag)) continue;
    if (t.trackedChanges && PROP_CHANGE_TAGS.has(tag)) continue;
    if (t.comments && COMMENT_REF_TAGS.has(tag)) continue;
    if (t.hiddenContent && tag === "w:r" && runIsHidden(node)) continue;
    if (t.trackedChanges && UNWRAP_TAGS.has(tag)) {
      const children = node[tag];
      if (Array.isArray(children)) {
        out.push(...transformDocumentNodes(children as XmlNode[], t));
      }
      continue;
    }
    const children = node[tag];
    if (Array.isArray(children)) {
      out.push({ ...node, [tag]: transformDocumentNodes(children as XmlNode[], t) });
    } else {
      out.push(node);
    }
  }
  return out;
}

// Drop Relationship nodes whose Target points at a removed comments part, so the package has no
// dangling relationship to a part that no longer exists.
function stripCommentRels(relsXml: string): string {
  const nodes = parseXml(relsXml);
  const filterRelationships = (list: XmlNode[]): XmlNode[] =>
    list
      .filter((node) => {
        if (nodeTag(node) !== "Relationship") return true;
        const attrs = (node[":@"] ?? {}) as Record<string, unknown>;
        const rawTarget = attrs["@_Target"];
        const target = typeof rawTarget === "string" ? rawTarget : "";
        return !/(^|\/)(comments|commentsExtended|commentsIds|people)\.xml$/.test(target);
      })
      .map((node) => {
        const tag = nodeTag(node);
        if (tag !== undefined && Array.isArray(node[tag])) {
          return { ...node, [tag]: filterRelationships(node[tag] as XmlNode[]) };
        }
        return node;
      });
  return buildXml(filterRelationships(nodes));
}

export function scrubDocx(bytes: Uint8Array, options: ScrubOptions): Uint8Array {
  const entries = safeUnzip(bytes);
  const out: Record<string, Uint8Array> = {};

  for (const [name, content] of Object.entries(entries)) {
    if (options.customProperties && name === "docProps/custom.xml") continue;
    if (options.comments && COMMENT_PART_PATTERN.test(name)) continue;

    if (options.identifyingMetadata && name === "docProps/core.xml") {
      out[name] = strToU8(EMPTY_CORE);
      continue;
    }
    if (options.identifyingMetadata && name === "docProps/app.xml") {
      out[name] = strToU8(EMPTY_APP);
      continue;
    }
    if (options.comments && name === "word/_rels/document.xml.rels") {
      out[name] = strToU8(stripCommentRels(new TextDecoder().decode(content)));
      continue;
    }
    if (
      CONTENT_PART_PATTERN.test(name) &&
      (options.comments || options.hiddenContent || options.trackedChanges)
    ) {
      const nodes = parseXml(new TextDecoder().decode(content));
      const transformed = transformDocumentNodes(nodes, {
        comments: options.comments,
        hiddenContent: options.hiddenContent,
        trackedChanges: options.trackedChanges,
      });
      out[name] = strToU8(buildXml(transformed));
      continue;
    }
    out[name] = content;
  }

  return zipSync(out);
}
