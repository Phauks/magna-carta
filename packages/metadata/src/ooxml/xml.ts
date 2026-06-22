import { XMLBuilder, XMLParser } from "fast-xml-parser";

export type XmlNode = Record<string, unknown>;

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  preserveOrder: true,
  trimValues: false,
  // Self-closing and empty elements must survive the round-trip unchanged.
  parseTagValue: false,
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
  return XML_DECL + new XMLBuilder(BUILDER_OPTIONS).build(nodes);
}

// The element name of a preserve-order node: its single key that is neither the attribute bag (":@")
// nor a text node ("#text").
export function nodeTag(node: XmlNode): string | undefined {
  for (const key of Object.keys(node)) {
    if (key !== ":@" && key !== "#text") return key;
  }
  return undefined;
}
