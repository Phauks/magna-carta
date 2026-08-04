import { XMLBuilder, XMLParser } from "fast-xml-parser";

// The preserve-order node shape fast-xml-parser produces: one element key plus the ":@" attribute bag
// and "#text" leaves.
export type XmlNode = Record<string, unknown>;

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  // Word encodes significant leading and trailing spaces inside w:t elements and relies on them being
  // preserved byte-for-byte; trimming would silently reflow a document's text.
  trimValues: false,
  parseTagValue: false,
  // Drop the source declaration: buildXml writes exactly one back. Keeping it in the tree makes the
  // builder emit a SECOND declaration after the one buildXml prepends, and a part with two of them is
  // not well-formed XML — a rewritten document that no reader will open, and nothing in a text-content
  // assertion catches it.
  ignoreDeclaration: true,
} as const;

const BUILDER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  suppressEmptyNode: false,
} as const;

export function parseXml(text: string): XmlNode[] {
  return new XMLParser(PARSER_OPTIONS).parse(text) as XmlNode[];
}

export function buildXml(nodes: XmlNode[]): string {
  return XML_DECLARATION + new XMLBuilder(BUILDER_OPTIONS).build(nodes);
}

// The element name of a preserve-order node: its single key that is neither the attribute bag (":@")
// nor a text node ("#text").
export function nodeTag(node: XmlNode): string | undefined {
  for (const key of Object.keys(node)) {
    if (key !== ":@" && key !== "#text") return key;
  }
  return undefined;
}

export function attributesOf(node: XmlNode): Record<string, unknown> {
  return (node[":@"] ?? {}) as Record<string, unknown>;
}

export function childrenOf(node: XmlNode, tag: string): XmlNode[] {
  const children = node[tag];
  return Array.isArray(children) ? (children as XmlNode[]) : [];
}

// The concatenated text of a "#text" leaf, or the empty string for an element node. Word writes the
// number 0 into some text positions and fast-xml-parser hands those back as numbers even with
// parseTagValue off, so the coercion is explicit rather than a cast.
export function textOf(node: XmlNode): string {
  const value = node["#text"];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
