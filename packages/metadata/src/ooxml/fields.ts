// The values behind a word-processing document's findings: the properties, the settings, the custom
// data, and who changed or commented on what and when. Inspect counts; this reads. Both walk the same
// parts (parts.ts, walk.ts), so a value is read from exactly the place the scrub removes it from.

import {
  cleanText,
  FieldCollector,
  momentOf,
  momentOrText,
  TEXT_GATHER_LIMIT,
  textValue,
} from "../fields.ts";
import type { DocumentPart, FieldMoment, FieldValue, RevisionKind } from "../model.ts";
import { attributesOf, PROP_CHANGE_TAGS, runIsHidden } from "./walk.ts";
import { nodeTag, parseXml, type XmlNode } from "./xml.ts";

function childrenOf(node: XmlNode, tag: string): XmlNode[] {
  const children = node[tag];
  return Array.isArray(children) ? (children as XmlNode[]) : [];
}

function localName(tag: string): string {
  const colon = tag.lastIndexOf(":");
  return colon === -1 ? tag : tag.slice(colon + 1);
}

function attribute(node: XmlNode, name: string): string | undefined {
  const value = attributesOf(node)[`@_${name}`];
  return typeof value === "string" ? value : undefined;
}

// The children of the document's root element: the properties, under coreProperties or Properties.
function rootChildren(xml: string | undefined): XmlNode[] {
  if (xml === undefined) return [];
  for (const node of parseXml(xml)) {
    const tag = nodeTag(node);
    if (tag !== undefined && !tag.startsWith("?")) return childrenOf(node, tag);
  }
  return [];
}

// The text directly inside an element, when it holds nothing but text. An element with element
// children (a vector, a nested record) is not a single value and reads as undefined.
function leafText(node: XmlNode): string | undefined {
  const tag = nodeTag(node);
  if (tag === undefined) return undefined;
  let text = "";
  for (const child of childrenOf(node, tag)) {
    if (nodeTag(child) !== undefined) return undefined;
    const value = child["#text"];
    if (typeof value === "string" || typeof value === "number") text += String(value);
  }
  return text;
}

interface TextBuffer {
  text: string;
}

function append(buffer: TextBuffer, text: string): void {
  if (buffer.text.length < TEXT_GATHER_LIMIT) buffer.text += text;
}

// The visible words under a node: the text of w:t (or w:delText, inside a deletion) and a space for
// each tab, break and paragraph end, so words in adjacent paragraphs do not run together.
function gatherText(nodes: XmlNode[], textTag: string, buffer: TextBuffer): void {
  for (const node of nodes) {
    if (buffer.text.length >= TEXT_GATHER_LIMIT) return;
    const tag = nodeTag(node);
    if (tag === undefined) continue;
    if (tag === textTag || tag === "w:instrText" || tag === "w:delInstrText") {
      if (tag === textTag) append(buffer, leafText(node) ?? "");
      continue;
    }
    if (tag === "w:tab" || tag === "w:br" || tag === "w:cr") append(buffer, " ");
    gatherText(childrenOf(node, tag), textTag, buffer);
    if (tag === "w:p") append(buffer, " ");
  }
}

function textUnder(node: XmlNode, textTag: string): string {
  const tag = nodeTag(node);
  if (tag === undefined) return "";
  const buffer = { text: "" };
  gatherText(childrenOf(node, tag), textTag, buffer);
  return buffer.text;
}

function momentAttribute(node: XmlNode): FieldMoment | undefined {
  const raw = attribute(node, "w:date");
  return raw === undefined ? undefined : momentOf(raw);
}

// ---------------------------------------------------------------------------------------------
// Document properties: docProps/core.xml and docProps/app.xml.
// ---------------------------------------------------------------------------------------------

// The core properties by element name, in the order a person would look for them. An element not
// named here is still shown, under its own local name, so a property no list anticipated is never
// hidden by the reader.
const CORE_PROPERTY_NAMES: ReadonlyMap<string, string> = new Map([
  ["dc:creator", "Author"],
  ["cp:lastModifiedBy", "Last Saved By"],
  ["dc:title", "Title"],
  ["dc:subject", "Subject"],
  ["dc:description", "Description"],
  ["cp:keywords", "Keywords"],
  ["cp:category", "Category"],
  ["cp:contentStatus", "Status"],
  ["dcterms:created", "Created"],
  ["dcterms:modified", "Modified"],
  ["cp:lastPrinted", "Last Printed"],
  ["cp:revision", "Revision Number"],
  ["cp:version", "Version"],
  ["dc:identifier", "Identifier"],
  ["dc:language", "Language"],
]);

// The extended properties worth a reader's time. The rest of app.xml is statistics (page, word and
// line counts) and layout flags, which identify nobody.
const APP_PROPERTY_NAMES: ReadonlyMap<string, string> = new Map([
  ["Company", "Company"],
  ["Manager", "Manager"],
  ["Template", "Template"],
  ["TotalTime", "Total Editing Time"],
  ["Application", "Application"],
  ["AppVersion", "Application Version"],
  ["HyperlinkBase", "Hyperlink Base"],
]);

function corePropertyOrder(tag: string): number {
  const names = [...CORE_PROPERTY_NAMES.keys()];
  const index = names.indexOf(tag);
  return index === -1 ? names.length : index;
}

/** The named values in core.xml and app.xml. */
export function propertyFields(core: string | undefined, app: string | undefined): FieldCollector {
  const fields = new FieldCollector();
  const coreNodes = rootChildren(core)
    .filter((node) => nodeTag(node) !== undefined)
    .toSorted((a, b) => corePropertyOrder(nodeTag(a) ?? "") - corePropertyOrder(nodeTag(b) ?? ""));
  for (const node of coreNodes) {
    const tag = nodeTag(node) ?? "";
    const raw = leafText(node);
    if (raw === undefined) continue;
    const name = CORE_PROPERTY_NAMES.get(tag) ?? localName(tag);
    const value =
      tag.startsWith("dcterms:") || tag === "cp:lastPrinted" ? momentOrText(raw) : textValue(raw);
    fields.addNamed(name, value);
  }
  for (const node of rootChildren(app)) {
    const tag = nodeTag(node);
    const name = tag === undefined ? undefined : APP_PROPERTY_NAMES.get(tag);
    if (name === undefined) continue;
    const raw = leafText(node);
    if (raw === undefined) continue;
    if (tag === "TotalTime") {
      const minutes = Number(raw.trim());
      if (raw.trim() !== "" && Number.isFinite(minutes) && minutes > 0) {
        fields.add({ name, value: { form: "minutes", minutes } });
      }
      continue;
    }
    fields.addNamed(name, textValue(raw));
  }
  return fields;
}

// ---------------------------------------------------------------------------------------------
// Custom properties: docProps/custom.xml.
// ---------------------------------------------------------------------------------------------

/** Each custom property by its name, with its typed value. */
export function customPropertyFields(custom: string | undefined): FieldCollector {
  const fields = new FieldCollector();
  for (const property of rootChildren(custom)) {
    const tag = nodeTag(property);
    if (tag === undefined || localName(tag) !== "property") continue;
    const name = attribute(property, "name") ?? "";
    for (const typed of childrenOf(property, tag)) {
      const typedTag = nodeTag(typed);
      if (typedTag === undefined) continue;
      const raw = leafText(typed);
      if (raw === undefined) continue;
      const value: FieldValue | undefined =
        localName(typedTag) === "filetime" || localName(typedTag) === "date"
          ? momentOrText(raw)
          : textValue(raw);
      fields.addNamed(name, value);
      break;
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------------------------
// Settings: the attached template, the mail-merge source and the document variables.
// ---------------------------------------------------------------------------------------------

// Relationship id to target, from a part's relationships. The template and the mail-merge source
// are named by relationship; the target is the path that discloses the firm's file server.
function relationshipTargets(rels: string | undefined): Map<string, string> {
  const targets = new Map<string, string>();
  for (const relationship of rootChildren(rels)) {
    const id = attribute(relationship, "Id");
    const target = attribute(relationship, "Target");
    if (id !== undefined && target !== undefined) targets.set(id, target);
  }
  return targets;
}

/** The attached template, the mail-merge source and query, and each document variable. */
export function settingsFields(
  settings: string | undefined,
  settingsRels: string | undefined,
): FieldCollector {
  const fields = new FieldCollector();
  const targets = relationshipTargets(settingsRels);
  const targetOf = (node: XmlNode): string | undefined => {
    const id = attribute(node, "r:id");
    return id === undefined ? undefined : targets.get(id);
  };
  for (const node of rootChildren(settings)) {
    const tag = nodeTag(node);
    if (tag === "w:attachedTemplate") {
      fields.addNamed("Attached Template", textValue(targetOf(node)));
    } else if (tag === "w:mailMerge") {
      for (const setting of childrenOf(node, tag)) {
        const settingTag = nodeTag(setting);
        if (settingTag === "w:dataSource" || settingTag === "w:headerSource") {
          fields.addNamed("Mail Merge Source", textValue(targetOf(setting)));
        } else if (settingTag === "w:connectString") {
          fields.addNamed("Mail Merge Connection", textValue(attribute(setting, "w:val")));
        } else if (settingTag === "w:query") {
          fields.addNamed("Mail Merge Query", textValue(attribute(setting, "w:val")));
        }
      }
    } else if (tag === "w:docVars") {
      for (const variable of childrenOf(node, tag)) {
        if (nodeTag(variable) !== "w:docVar") continue;
        fields.addNamed(
          attribute(variable, "w:name") ?? "",
          textValue(attribute(variable, "w:val")),
        );
      }
    }
  }
  return fields;
}

// ---------------------------------------------------------------------------------------------
// Custom XML data: customXml/itemN.xml.
// ---------------------------------------------------------------------------------------------

function collectLeaves(nodes: XmlNode[], fields: FieldCollector, depth: number): void {
  // A depth bound as well as the field cap: a crafted part can nest far deeper than any record.
  if (depth > 32) return;
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (tag === undefined || tag.startsWith("?")) continue;
    const text = leafText(node);
    if (text !== undefined) {
      fields.addNamed(localName(tag), textValue(text));
      continue;
    }
    collectLeaves(childrenOf(node, tag), fields, depth + 1);
  }
}

/** The named values a document-management system or template left in custom XML parts. */
export function customXmlFields(items: readonly string[]): FieldCollector {
  const fields = new FieldCollector();
  for (const xml of items) collectLeaves(parseXml(xml), fields, 0);
  return fields;
}

// ---------------------------------------------------------------------------------------------
// Comments: word/comments.xml.
// ---------------------------------------------------------------------------------------------

/** Who wrote each comment, what it says, and when. */
export function commentFields(comments: string | undefined): FieldCollector {
  const fields = new FieldCollector();
  for (const comment of rootChildren(comments)) {
    if (nodeTag(comment) !== "w:comment") continue;
    const value = textValue(textUnder(comment, "w:t")) ?? { form: "text", text: "" };
    const when = momentAttribute(comment);
    fields.add({
      name: cleanText(attribute(comment, "w:author") ?? ""),
      value,
      ...(when === undefined ? {} : { when }),
    });
  }
  return fields;
}

// ---------------------------------------------------------------------------------------------
// Tracked changes and hidden text: the content parts.
// ---------------------------------------------------------------------------------------------

/** Which part of the document a content part is. */
export function documentPartOf(partName: string): DocumentPart {
  if (/^word\/header\d*\.xml$/.test(partName)) return "header";
  if (/^word\/footer\d*\.xml$/.test(partName)) return "footer";
  if (partName === "word/footnotes.xml") return "footnotes";
  if (partName === "word/endnotes.xml") return "endnotes";
  return "body";
}

const REVISION_OF: ReadonlyMap<string, { kind: RevisionKind; textTag: string }> = new Map([
  ["w:ins", { kind: "inserted", textTag: "w:t" }],
  ["w:del", { kind: "deleted", textTag: "w:delText" }],
  ["w:moveTo", { kind: "moved", textTag: "w:t" }],
]);

export interface ContentFieldCollectors {
  readonly trackedChanges: FieldCollector;
  readonly hiddenText: FieldCollector;
}

export function contentFieldCollectors(): ContentFieldCollectors {
  return { trackedChanges: new FieldCollector(), hiddenText: new FieldCollector() };
}

// One formatting change is often recorded on every run it touched, so the same author and moment
// would fill the table with identical rows. They are listed once.
function formattingKey(author: string, when: FieldMoment | undefined): string {
  return `${author}\u0000${JSON.stringify(when ?? null)}`;
}

/**
 * Read the tracked changes and hidden text in one content part. Each insertion, deletion and move
 * is a row with its author, its words and its moment; a formatting change is a row with no words.
 * Hidden runs in one paragraph are one row, so a hidden sentence split over runs reads as a sentence.
 */
export function readContentPart(
  partName: string,
  nodes: XmlNode[],
  collectors: ContentFieldCollectors,
  seenFormatting: Set<string>,
): void {
  const part = documentPartOf(partName);

  const visit = (list: XmlNode[], paragraph: TextBuffer | undefined, depth: number): void => {
    if (depth > 256) return;
    for (const node of list) {
      const tag = nodeTag(node);
      if (tag === undefined) continue;
      const revision = REVISION_OF.get(tag);
      if (revision !== undefined) {
        const words = textUnder(node, revision.textTag);
        const value = textValue(words);
        // An empty w:ins or w:del marks an inserted or deleted paragraph mark or table row: a
        // change with no words of its own, counted by inspect and not worth a row of nothing.
        if (value !== undefined) {
          const when = momentAttribute(node);
          collectors.trackedChanges.add({
            name: cleanText(attribute(node, "w:author") ?? ""),
            value,
            revision: revision.kind,
            ...(when === undefined ? {} : { when }),
          });
        }
      } else if (PROP_CHANGE_TAGS.has(tag)) {
        const author = cleanText(attribute(node, "w:author") ?? "");
        const when = momentAttribute(node);
        const key = formattingKey(author, when);
        if (!seenFormatting.has(key)) {
          seenFormatting.add(key);
          collectors.trackedChanges.add({
            name: author,
            value: { form: "text", text: "" },
            revision: "formatted",
            ...(when === undefined ? {} : { when }),
          });
        }
        continue; // the previous formatting it records carries no text worth reading
      }
      if (tag === "w:p") {
        const hidden: TextBuffer = { text: "" };
        visit(childrenOf(node, tag), hidden, depth + 1);
        const value = textValue(hidden.text);
        if (value !== undefined) collectors.hiddenText.add({ name: "", value, part });
        continue;
      }
      if (tag === "w:r" && paragraph !== undefined && runIsHidden(node)) {
        append(paragraph, textUnder(node, "w:t"));
        append(paragraph, textUnder(node, "w:delText"));
      }
      visit(childrenOf(node, tag), paragraph, depth + 1);
    }
  };

  visit(nodes, undefined, 0);
}
