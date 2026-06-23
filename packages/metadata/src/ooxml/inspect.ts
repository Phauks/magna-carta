import { safeUnzip } from "../guards.ts";
import { type Finding, type MetadataReport, reportOf } from "../model.ts";
import { COMMENT_REF_TAGS, runIsHidden, TRACKED_CHANGE_TAGS } from "./walk.ts";
import { nodeTag, parseXml, type XmlNode } from "./xml.ts";

function decode(bytes: Uint8Array | undefined): string | undefined {
  return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
}

// Walk a preserve-order tree, counting nodes whose tag is in `tags`. Also counts a hidden run when
// `countVanish` is set and a w:r's w:rPr contains an enabled w:vanish.
function walk(
  nodes: XmlNode[],
  tags: ReadonlySet<string>,
  countVanish: boolean,
  acc: { tagged: number; vanish: number },
): void {
  for (const node of nodes) {
    const tag = nodeTag(node);
    if (tag === undefined) continue;
    if (tags.has(tag)) acc.tagged++;
    if (countVanish && tag === "w:r" && runIsHidden(node)) acc.vanish++;
    const children = node[tag];
    if (Array.isArray(children)) walk(children as XmlNode[], tags, countVanish, acc);
  }
}

function hasMeaningfulChild(xml: string | undefined, ignoreRoot: boolean): boolean {
  if (xml === undefined) return false;
  const nodes = parseXml(xml);
  // The first node is the root element; identifying metadata is any non-empty child element of it.
  const root = ignoreRoot ? findFirstElement(nodes) : { children: nodes };
  const children = root?.children ?? [];
  for (const child of children) {
    const tag = nodeTag(child as XmlNode);
    if (tag === undefined) continue;
    const inner = (child as XmlNode)[tag];
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

  const core = decode(entries["docProps/core.xml"]);
  const app = decode(entries["docProps/app.xml"]);
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

  if (hasMeaningfulChild(decode(entries["docProps/custom.xml"]), true)) {
    findings.push({
      category: "custom-properties",
      label: "Custom document properties",
      risk: "medium",
      count: 1,
      defaultScrub: true,
    });
  }

  const document = decode(entries["word/document.xml"]);
  const acc = { tagged: 0, vanish: 0 };
  let commentRefs = 0;
  if (document !== undefined) {
    const docNodes = parseXml(document);
    walk(docNodes, TRACKED_CHANGE_TAGS, true, acc);
    const commentAcc = { tagged: 0, vanish: 0 };
    walk(docNodes, COMMENT_REF_TAGS, false, commentAcc);
    commentRefs = commentAcc.tagged;
  }
  if (acc.tagged > 0) {
    findings.push({
      category: "tracked-changes",
      label: "Tracked insertions, deletions, moves, or formatting changes",
      risk: "high",
      count: acc.tagged,
      defaultScrub: true,
    });
  }
  if (acc.vanish > 0) {
    findings.push({
      category: "hidden-content",
      label: "Hidden text",
      risk: "high",
      count: acc.vanish,
      defaultScrub: true,
    });
  }

  const hasCommentsPart = entries["word/comments.xml"] !== undefined;
  if (hasCommentsPart || commentRefs > 0) {
    findings.push({
      category: "comments",
      label: "Reviewer comments",
      risk: "high",
      count: Math.max(commentRefs, hasCommentsPart ? 1 : 0),
      defaultScrub: true,
    });
  }

  return reportOf("docx", findings);
}
