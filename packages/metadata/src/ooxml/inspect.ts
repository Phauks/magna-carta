import { safeUnzip } from "../guards.ts";
import { type Finding, type MetadataReport, reportOf } from "../model.ts";
import {
  APP_PART,
  COMMENT_PART_PATTERN,
  CORE_PART,
  countOccurrences,
  CUSTOM_PROPERTIES_PART,
  CUSTOM_XML_PART_PATTERN,
  REVISION_SAVE_IDENTIFIER_MARKER,
  SETTINGS_PART,
  SETTINGS_TAGS_CUSTOM,
  SETTINGS_TAGS_IDENTIFYING,
  THUMBNAIL_PART_PATTERN,
  WORD_PART_PATTERN,
} from "./parts.ts";
import {
  COMMENT_REF_TAGS,
  CONTENT_PART_PATTERN,
  runIsHidden,
  TRACKED_CHANGE_TAGS,
} from "./walk.ts";
import { nodeTag, parseXml, type XmlNode } from "./xml.ts";

const SETTINGS_DISCLOSURE_TAGS: ReadonlySet<string> = new Set([
  ...SETTINGS_TAGS_IDENTIFYING,
  ...SETTINGS_TAGS_CUSTOM,
]);

function decode(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}

// Walk a preserve-order tree, counting nodes whose tag is in `tags`. Also counts a hidden run when
// `countVanish` is set and a w:r's w:rPr contains an enabled w:vanish.
function walk(
  nodes: XmlNode[],
  tags: ReadonlySet<string>,
  countVanish: boolean,
  accumulator: { tagged: number; vanish: number },
): void {
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (tag === undefined) continue;
    if (tags.has(tag)) accumulator.tagged++;
    if (countVanish && tag === "w:r" && runIsHidden(node)) accumulator.vanish++;
    const children = node[tag];
    if (Array.isArray(children)) walk(children as XmlNode[], tags, countVanish, accumulator);
  }
}

function countTags(xml: string | undefined, tags: ReadonlySet<string>): number {
  if (xml === undefined) return 0;
  const accumulator = { tagged: 0, vanish: 0 };
  walk(parseXml(xml), tags, false, accumulator);
  return accumulator.tagged;
}

function hasMeaningfulChild(xml: string | undefined, ignoreRoot: boolean): boolean {
  if (xml === undefined) return false;
  const nodes = parseXml(xml);
  // The first node is the root element; identifying metadata is any non-empty child element of it.
  const root = ignoreRoot ? findFirstElement(nodes) : { children: nodes };
  const children = root?.children ?? [];
  for (const child of children) {
    const tag = nodeTag(child);
    if (tag === undefined) continue;
    const inner = child[tag];
    if (Array.isArray(inner) && inner.length > 0) return true;
  }
  return false;
}

function findFirstElement(nodes: XmlNode[]): { children: XmlNode[] } | undefined {
  for (const node of nodes) {
    const tag = nodeTag(node);
    // Skip XML processing instructions (e.g. ?xml) — they start with "?" and are not elements.
    if (tag !== undefined && !tag.startsWith("?") && Array.isArray(node[tag])) {
      return { children: node[tag] as XmlNode[] };
    }
  }
  return undefined;
}

export function inspectDocx(bytes: Uint8Array): MetadataReport {
  const entries = safeUnzip(bytes);
  const findings: Finding[] = [];

  const core = decode(entries[CORE_PART]);
  const app = decode(entries[APP_PART]);
  const identifyingPresent = hasMeaningfulChild(core, true) || hasMeaningfulChild(app, true);
  if (identifyingPresent) {
    findings.push({
      category: "identifying-metadata",
      label: "Author, organization, dates, and revision details",
      risk: "high",
      count: 1,
      defaultScrub: true,
    });
  }

  if (hasMeaningfulChild(decode(entries[CUSTOM_PROPERTIES_PART]), true)) {
    findings.push({
      category: "custom-properties",
      label: "Custom document properties",
      risk: "medium",
      count: 1,
      defaultScrub: true,
    });
  }

  // Whole parts that carry content or data of their own. They survive every transform applied to the
  // word-processing XML, so they are reported as their own findings rather than folded into one of
  // the content categories.
  const partNames = Object.keys(entries);
  const thumbnails = partNames.filter((name) => THUMBNAIL_PART_PATTERN.test(name));
  if (thumbnails.length > 0) {
    findings.push({
      category: "embedded-preview",
      label: "Embedded preview image of the first page",
      risk: "high",
      count: thumbnails.length,
      defaultScrub: true,
    });
  }

  const customXmlItems = partNames.filter(
    (name) => CUSTOM_XML_PART_PATTERN.test(name) && /^customXml\/item\d*\.xml$/.test(name),
  );
  if (customXmlItems.length > 0) {
    findings.push({
      category: "embedded-data",
      label: "Embedded custom XML data",
      risk: "high",
      count: customXmlItems.length,
      defaultScrub: true,
    });
  }

  const settings = decode(entries[SETTINGS_PART]);
  const settingsDisclosures = countTags(settings, SETTINGS_DISCLOSURE_TAGS);
  if (settingsDisclosures > 0) {
    findings.push({
      category: "document-settings",
      label: "Stored document variables, mail-merge data source, or attached template",
      risk: "medium",
      count: settingsDisclosures,
      defaultScrub: true,
    });
  }

  // Revision save identifiers are stamped across every word-processing part, as attributes on
  // content elements and as elements of their own in settings and styles. Counting the marker in the
  // raw part text finds both without parsing parts this read would otherwise never open.
  let revisionSaveIdentifiers = 0;
  for (const [name, content] of Object.entries(entries)) {
    if (!WORD_PART_PATTERN.test(name)) continue;
    revisionSaveIdentifiers += countOccurrences(
      decode(content) ?? "",
      REVISION_SAVE_IDENTIFIER_MARKER,
    );
  }
  if (revisionSaveIdentifiers > 0) {
    findings.push({
      category: "edit-history",
      label: "Editing-session identifiers linking passages to writing sessions",
      risk: "medium",
      count: revisionSaveIdentifiers,
      defaultScrub: true,
    });
  }

  // Walk all word-processing content parts (document body, headers, footers, footnotes, endnotes)
  // so that tracked changes, hidden runs, and comment references in any of those parts are found.
  const accumulator = { tagged: 0, vanish: 0 };
  let commentRefs = 0;
  for (const [name, content] of Object.entries(entries)) {
    if (!CONTENT_PART_PATTERN.test(name)) continue;
    const xml = decode(content);
    if (xml === undefined) continue;
    const nodes = parseXml(xml);
    walk(nodes, TRACKED_CHANGE_TAGS, true, accumulator);
    const commentAccumulator = { tagged: 0, vanish: 0 };
    walk(nodes, COMMENT_REF_TAGS, false, commentAccumulator);
    commentRefs += commentAccumulator.tagged;
  }
  if (accumulator.tagged > 0) {
    findings.push({
      category: "tracked-changes",
      label: "Tracked insertions, deletions, moves, or formatting changes",
      risk: "high",
      count: accumulator.tagged,
      defaultScrub: true,
    });
  }
  if (accumulator.vanish > 0) {
    findings.push({
      category: "hidden-content",
      label: "Hidden text",
      risk: "high",
      count: accumulator.vanish,
      defaultScrub: true,
    });
  }

  const commentParts = partNames.filter((name) => COMMENT_PART_PATTERN.test(name));
  if (commentParts.length > 0 || commentRefs > 0) {
    findings.push({
      category: "comments",
      label: "Reviewer comments",
      risk: "high",
      count: Math.max(commentRefs, commentParts.length),
      defaultScrub: true,
    });
  }

  return reportOf("docx", findings);
}
