import { deflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import { assemble, packageIntegrityViolations } from "../src/assemble.ts";
import {
  EMU_PER_INCH,
  heightForWidth,
  MAX_IMAGE_BYTES,
  readImageFacts,
  relationshipTargetFor,
  SUPPORTED_IMAGE_CONTENT_TYPES,
} from "../src/ooxml/image.ts";
import { readPackage, readPartText } from "../src/ooxml/package.ts";
import type { MergeContext, MergeValue } from "../src/types.ts";
import { buildDocx, documentXml, headerXml, paragraphOfRuns } from "./support/docx-fixture.ts";

// The letterhead logo — the engine's first image work. A picture in a `.docx` is four things that must
// all be true together (the part, its content type, its relationship, the drawing), and the failure mode
// when one is missing is a document whose TEXT is entirely correct and which no reader will open. Every
// assertion below is therefore over the emitted package rather than over the words in it.

// ---------------------------------------------------------------------------------------------
// Fixtures: the smallest real PNG and JPEG headers, built rather than committed
// ---------------------------------------------------------------------------------------------

function bigEndian32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

// A PNG whose IHDR declares the given size. The image data is a real deflate stream so nothing in the
// file is a lie, but no decoder ever runs — the engine reads the header and embeds the bytes verbatim.
function pngBytes(width: number, height: number): Uint8Array {
  const ihdr = [
    ...bigEndian32(width),
    ...bigEndian32(height),
    8, // bit depth
    6, // colour type: RGBA
    0,
    0,
    0,
  ];
  const chunk = (type: string, body: readonly number[]): number[] => [
    ...bigEndian32(body.length),
    ...Array.from(type, (character) => character.charCodeAt(0)),
    ...body,
    // The CRC is not checked anywhere in this engine; a fixed placeholder keeps the fixture readable.
    0,
    0,
    0,
    0,
  ];
  const pixels = deflateSync(new Uint8Array(width * height * 4 + height));
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", [...pixels]),
    ...chunk("IEND", []),
  ]);
}

// A JPEG whose start-of-frame declares the given size, preceded by an application segment so the marker
// walk has to actually walk rather than read a fixed offset.
function jpegBytes(width: number, height: number): Uint8Array {
  const applicationSegment = [0xff, 0xe0, 0x00, 0x10, ...new Array<number>(14).fill(0)];
  const startOfFrame = [
    0xff,
    0xc0,
    0x00,
    0x11,
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    3,
    ...new Array<number>(9).fill(0),
  ];
  return new Uint8Array([0xff, 0xd8, ...applicationSegment, ...startOfFrame, 0xff, 0xd9]);
}

const ONE_INCH = EMU_PER_INCH;

function imageValue(bytes: Uint8Array, widthEmu = ONE_INCH): MergeValue {
  const facts = readImageFacts(bytes);
  if (!facts.ok) throw new Error(`fixture is not a readable image: ${facts.detail}`);
  return {
    kind: "image",
    bytes,
    contentType: facts.value.contentType,
    widthEmu,
    heightEmu: heightForWidth(facts.value, widthEmu),
    description: "Riverside Law LLP letterhead",
  };
}

function contextWith(values: readonly (readonly [string, MergeValue])[]): MergeContext {
  return { values: new Map(values), absentKeys: [], absenceReasons: new Map(), timeZone: "UTC" };
}

// ---------------------------------------------------------------------------------------------

describe("the image format policy", () => {
  it("accepts a PNG and a JPEG and reads their intrinsic size from the bytes", () => {
    const png = readImageFacts(pngBytes(300, 100));
    expect(png.ok).toBe(true);
    if (png.ok) {
      expect(png.value).toMatchObject({
        contentType: "image/png",
        extension: "png",
        widthPixels: 300,
        heightPixels: 100,
      });
    }
    const jpeg = readImageFacts(jpegBytes(240, 60));
    expect(jpeg.ok).toBe(true);
    if (jpeg.ok) {
      expect(jpeg.value).toMatchObject({
        contentType: "image/jpeg",
        extension: "jpeg",
        widthPixels: 240,
        heightPixels: 60,
      });
    }
    expect([...SUPPORTED_IMAGE_CONTENT_TYPES].sort()).toEqual(["image/jpeg", "image/png"]);
  });

  it("refuses every other format, whatever the bytes claim to be", () => {
    // An SVG is a document, a GIF and a BMP are formats nothing here needs, and a `.png` name over
    // arbitrary bytes is a claim rather than a fact. All four are refused on the bytes themselves.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0]);
    const bitmap = new Uint8Array([0x42, 0x4d, 0, 0, 0, 0, 0, 0, 0, 0]);
    const metafile = new Uint8Array([0xd7, 0xcd, 0xc6, 0x9a, 0, 0, 0, 0]);
    for (const bytes of [svg, gif, bitmap, metafile]) {
      const outcome = readImageFacts(bytes);
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toBe("unsupported-image-format");
    }
  });

  it("refuses an oversize asset before it parses a byte of it", () => {
    const enormous = new Uint8Array(MAX_IMAGE_BYTES + 1);
    enormous.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const outcome = readImageFacts(enormous);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("image-oversize");
  });

  it("refuses a truncated image whose size cannot be read, rather than guessing one", () => {
    const truncated = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const outcome = readImageFacts(truncated);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe("image-unreadable");
  });

  it("terminates on a malformed JPEG marker chain instead of walking off the end", () => {
    const nonsense = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0xff, 0xff, 0xff]);
    expect(readImageFacts(nonsense).ok).toBe(false);
  });
});

describe("the box the asset declares", () => {
  it("derives the height from the intrinsic proportions, so nothing can print a stretched logo", () => {
    const facts = readImageFacts(pngBytes(300, 100));
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;
    expect(heightForWidth(facts.value, ONE_INCH)).toBe(Math.round(ONE_INCH / 3));
    expect(heightForWidth(facts.value, ONE_INCH * 2)).toBe(Math.round((ONE_INCH * 2) / 3));
  });

  it("spells a relationship target relative to the part that draws it", () => {
    expect(relationshipTargetFor("word/header1.xml", "word/media/letterhead1.png")).toBe(
      "media/letterhead1.png",
    );
    expect(relationshipTargetFor("word/document.xml", "word/media/letterhead1.jpeg")).toBe(
      "media/letterhead1.jpeg",
    );
  });
});

describe("assembling a letterhead", () => {
  const logoParagraph = paragraphOfRuns("{{location.letterheadLogo}}");

  it("emits the part, the content type, the relationship, and the drawing — all four", () => {
    const template = buildDocx({ header: headerXml(logoParagraph) });
    const result = assemble(
      template,
      contextWith([["location.letterheadLogo", imageValue(pngBytes(300, 100))]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const read = readPackage(result.bytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const parts = read.value;

    // 1. the part
    const mediaParts = [...parts.keys()].filter((name) => name.startsWith("word/media/"));
    expect(mediaParts).toEqual(["word/media/letterhead1.png"]);

    // 2. the content type, declared for the extension
    expect(readPartText(parts, "[Content_Types].xml")).toContain(
      '<Default Extension="png" ContentType="image/png"',
    );

    // 3. the relationship, on the HEADER's own relationship part and nowhere else
    const headerRelationships = readPartText(parts, "word/_rels/header1.xml.rels") ?? "";
    expect(headerRelationships).toContain('Target="media/letterhead1.png"');
    expect(headerRelationships).toContain(
      'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"',
    );
    expect(readPartText(parts, "word/_rels/document.xml.rels") ?? "").not.toContain("image");

    // 4. the drawing, referencing that relationship by the id the relationship part declares
    const header = readPartText(parts, "word/header1.xml") ?? "";
    const relationshipId = /Id="(rId\d+)"[^>]*relationships\/image/.exec(headerRelationships)?.[1];
    expect(relationshipId).toBeDefined();
    expect(header).toContain("<w:drawing>");
    expect(header).toContain(`r:embed="${relationshipId}"`);
    expect(header).toContain(`cx="${ONE_INCH}"`);
    // The placeholder text is gone: a picture REPLACES it rather than sitting beside it.
    expect(header).not.toContain("{{location.letterheadLogo}}");

    // Every namespace the drawing uses is bound on the element that uses it, because a header's root
    // declares only `w:` and a prefix used but not bound is not well-formed XML.
    expect(header).toContain('xmlns:wp="');
    expect(header).toContain('xmlns:a="');
    expect(header).toContain('xmlns:pic="');
    expect(header).toContain('xmlns:r="');

    expect(packageIntegrityViolations(parts)).toEqual([]);
  });

  it("keeps the words either side of a logo dropped into the middle of a line", () => {
    const template = buildDocx({
      document: documentXml(paragraphOfRuns("Before {{location.letterheadLogo}} after")),
    });
    const result = assemble(
      template,
      contextWith([["location.letterheadLogo", imageValue(jpegBytes(200, 50))]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = readPackage(result.bytes);
    if (!read.ok) return;
    const document = readPartText(read.value, "word/document.xml") ?? "";
    expect(document).toContain("Before ");
    expect(document).toContain(" after");
    expect(document).toContain("<w:drawing>");
    expect(readPartText(read.value, "[Content_Types].xml")).toContain(
      '<Default Extension="jpeg" ContentType="image/jpeg"',
    );
    expect(packageIntegrityViolations(read.value)).toEqual([]);
  });

  it("gives two logos in one part two parts, two relationships, and two drawing ids", () => {
    const template = buildDocx({
      document: documentXml(logoParagraph, logoParagraph),
    });
    const result = assemble(
      template,
      contextWith([["location.letterheadLogo", imageValue(pngBytes(300, 100))]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = readPackage(result.bytes);
    if (!read.ok) return;
    const media = [...read.value.keys()].filter((name) => name.startsWith("word/media/"));
    expect(media).toEqual(["word/media/letterhead1.png", "word/media/letterhead2.png"]);
    const relationships = readPartText(read.value, "word/_rels/document.xml.rels") ?? "";
    expect([...relationships.matchAll(/relationships\/image/g)]).toHaveLength(2);
    const document = readPartText(read.value, "word/document.xml") ?? "";
    expect(document).toContain('<wp:docPr id="1"');
    expect(document).toContain('<wp:docPr id="2"');
    expect(packageIntegrityViolations(read.value)).toEqual([]);
  });

  it("does not collide with a relationship id the template already uses", () => {
    const existing =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>";
    const template = buildDocx({
      document: documentXml(logoParagraph),
      documentRels: existing,
      extra: { "word/styles.xml": "<styles/>" },
    });
    const result = assemble(
      template,
      contextWith([["location.letterheadLogo", imageValue(pngBytes(300, 100))]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = readPackage(result.bytes);
    if (!read.ok) return;
    const relationships = readPartText(read.value, "word/_rels/document.xml.rels") ?? "";
    expect(relationships).toContain('Id="rId8"');
    expect(relationships).toContain('Target="styles.xml"');
  });

  it("shows a visible marker rather than a hole when the office has set no logo", () => {
    const template = buildDocx({ document: documentXml(logoParagraph) });
    const result = assemble(template, contextWith([]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.absences).toEqual([
      { key: "location.letterheadLogo", rendered: "placeholder", reason: null },
    ]);
    const read = readPackage(result.bytes);
    if (!read.ok) return;
    expect(readPartText(read.value, "word/document.xml")).toContain("[LETTERHEAD LOGO]");
    expect([...read.value.keys()].filter((name) => name.startsWith("word/media/"))).toEqual([]);
  });

  it("shows a marker rather than embedding bytes the format policy refuses", () => {
    // An asset that changed underneath the office. The policy is enforced when the logo is set, so
    // reaching this point means the object is no longer what it was — a marker says so on the page
    // instead of the assembly failing or a document carrying a format nothing will draw.
    const template = buildDocx({ document: documentXml(logoParagraph) });
    const notAnImage: MergeValue = {
      kind: "image",
      bytes: new TextEncoder().encode("<svg/>"),
      contentType: "image/png",
      widthEmu: ONE_INCH,
      heightEmu: ONE_INCH,
      description: "Riverside Law LLP letterhead",
    };
    const result = assemble(template, contextWith([["location.letterheadLogo", notAnImage]]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = readPackage(result.bytes);
    if (!read.ok) return;
    expect([...read.value.keys()].filter((name) => name.startsWith("word/media/"))).toEqual([]);
    expect(readPartText(read.value, "word/document.xml")).toContain("[LETTERHEAD LOGO]");
  });
});

describe("package integrity sees what a text assertion cannot", () => {
  it("catches a drawing that embeds a relationship its part never declared", () => {
    const template = buildDocx({
      document: documentXml(
        `<w:p><w:r><w:drawing><a:blip xmlns:a="x" xmlns:r="y" r:embed="rId99"/></w:drawing></w:r></w:p>`,
      ),
    });
    const read = readPackage(template);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(packageIntegrityViolations(read.value)).toEqual([
      "word/document.xml embeds rId99, which it does not declare",
    ]);
  });

  it("catches a relationship whose part is not in the package", () => {
    const relationships =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/gone.png"/>' +
      "</Relationships>";
    const template = buildDocx({
      document: documentXml(
        `<w:p><w:r><w:drawing><a:blip xmlns:a="x" xmlns:r="y" r:embed="rId5"/></w:drawing></w:r></w:p>`,
      ),
      documentRels: relationships,
    });
    const read = readPackage(template);
    if (!read.ok) return;
    expect(packageIntegrityViolations(read.value)).toEqual([
      "word/document.xml embeds rId5, whose part word/media/gone.png is absent",
    ]);
  });

  it("catches an image part carried with no declared content type for its extension", () => {
    const relationships =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/mark.png"/>' +
      "</Relationships>";
    const template = buildDocx({
      document: documentXml(
        `<w:p><w:r><w:drawing><a:blip xmlns:a="x" xmlns:r="y" r:embed="rId5"/></w:drawing></w:r></w:p>`,
      ),
      documentRels: relationships,
      extra: { "word/media/mark.png": pngBytes(10, 10) },
    });
    const read = readPackage(template);
    if (!read.ok) return;
    expect(packageIntegrityViolations(read.value)).toEqual([
      "no content type is declared for .png parts",
    ]);
  });

  it("leaves a template's own external relationships alone", () => {
    // A hyperlink's target is not a part and must never be reported as a missing one.
    const relationships =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test/" TargetMode="External"/>' +
      "</Relationships>";
    const template = buildDocx({
      document: documentXml(
        `<w:p><w:r><w:drawing><a:blip xmlns:a="x" xmlns:r="y" r:embed="rId3"/></w:drawing></w:r></w:p>`,
      ),
      documentRels: relationships,
    });
    const read = readPackage(template);
    if (!read.ok) return;
    expect(packageIntegrityViolations(read.value)).toEqual([]);
  });
});
