import { describe, expect, it } from "vitest";
import { parseXml, buildXml, nodeTag, type XmlNode } from "../src/ooxml/xml.ts";
import { runIsHidden, TRACKED_CHANGE_TAGS } from "../src/ooxml/walk.ts";

describe("ooxml/xml", () => {
  it("round-trips an element preserving order and attributes", () => {
    const xml = '<w:p><w:r w:id="1"><w:t>hello</w:t></w:r></w:p>';
    const nodes = parseXml(xml);
    const out = buildXml(nodes);
    expect(out).toContain("<w:t>hello</w:t>");
    expect(out).toContain('w:id="1"');
  });

  it("writes exactly one XML declaration for a part that already had one", () => {
    // Two declarations make the part malformed, and a rewritten part is what the scrubbed document
    // is built from — so this is the difference between a cleaned file and an unopenable one.
    const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:p><w:r/></w:p>';
    const out = buildXml(parseXml(xml));
    expect(out.match(/<\?xml/g)).toHaveLength(1);
    expect(out.indexOf("<?xml")).toBe(0);
  });

  it("nodeTag returns the element key", () => {
    const nodes = parseXml("<w:p/>") as Record<string, unknown>[];
    expect(nodeTag(nodes[0]!)).toBe("w:p");
  });
});

describe("ooxml/walk", () => {
  it("TRACKED_CHANGE_TAGS unions removes, unwraps, and change records", () => {
    for (const tag of ["w:del", "w:ins", "w:rPrChange"]) {
      expect(TRACKED_CHANGE_TAGS.has(tag)).toBe(true);
    }
  });

  it("runIsHidden detects an enabled vanish and ignores a disabled one", () => {
    const hidden = parseXml("<w:r><w:rPr><w:vanish/></w:rPr><w:t>x</w:t></w:r>");
    const shown = parseXml('<w:r><w:rPr><w:vanish w:val="false"/></w:rPr><w:t>x</w:t></w:r>');
    expect(runIsHidden(hidden[0]!)).toBe(true);
    expect(runIsHidden(shown[0]!)).toBe(false);
  });
});
