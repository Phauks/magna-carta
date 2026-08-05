import { failed, succeeded, type Outcome } from "../types.ts";
import { readPartText, writePartText, type PartMap } from "./package.ts";
import { CONTENT_TYPES_PART, relationshipPartFor } from "./parts.ts";
import { attributesOf, buildXml, nodeTag, parseXml, type XmlNode } from "./xml.ts";

// The engine's image work: put a picture into an OOXML package, correctly.
//
// "Correctly" is four things that must all be true together, which is why they live in one module rather
// than being done where they are needed. A picture in a `.docx` is a PART (the bytes), a CONTENT TYPE
// (what the bytes are, declared for the whole package), a RELATIONSHIP (how the part that draws it
// refers to it, per part, by an id local to that part), and a DRAWING (the markup at the position it
// appears). Emit three of the four and a reader declares the document damaged — and no assertion over
// the document's text can see it, which is why the integrity checks in assemble.ts read the package
// rather than the words.

// ---------------------------------------------------------------------------------------------
// The format policy
// ---------------------------------------------------------------------------------------------

// PNG AND JPEG, AND NOTHING ELSE. The policy is deliberately narrower than what Word can open, and each
// exclusion is a decision rather than an omission:
//
// - SVG is XML. An image format that is a document is a script and external-reference surface inside a
//   package we assert carries neither, and it would have to be scanned by the same passes the template
//   itself goes through. There is no letterhead a raster cannot express.
// - EMF and WMF are record-based metafiles replayed by a drawing interpreter — historically the richest
//   parser-attack surface in the whole format family, and unreadable outside Windows.
// - GIF, BMP, TIFF and WebP would each widen the content-type set, and the reader compatibility for a
//   printed letterhead is strictly worse. A firm has a PNG or a JPEG of its logo.
//
// The format is decided by the FIRST BYTES, never by the declared content type or the file name: a
// caller's label is a claim about bytes we are about to embed, and this is the one place that claim gets
// checked against the bytes themselves.
export const SUPPORTED_IMAGE_CONTENT_TYPES: readonly string[] = ["image/png", "image/jpeg"];

// A logo is tens of kilobytes. The cap is what keeps a "letterhead" from being a route by which a
// multi-megabyte payload is embedded into every document a firm assembles, and it is checked before the
// bytes are ever parsed.
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// The largest intrinsic pixel dimension worth accepting. Past this the asset is a photograph rather than
// a mark, and its pixels are being carried into every assembled document for nothing.
export const MAX_IMAGE_PIXELS = 10_000;

export type ImageFormatFailure =
  | "unsupported-image-format" // not PNG and not JPEG
  | "image-oversize" // past MAX_IMAGE_BYTES
  | "image-unreadable"; // the right magic bytes, but no readable intrinsic size

export interface ImageFacts {
  readonly contentType: "image/png" | "image/jpeg";
  // The part-name extension the content type is declared against. `jpeg`, never `jpg`: one extension per
  // content type, so a package can never carry two Defaults meaning the same thing.
  readonly extension: "png" | "jpeg";
  readonly widthPixels: number;
  readonly heightPixels: number;
}

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWithSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

function readBigEndian32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) << 24) |
    ((bytes[offset + 1] ?? 0) << 16) |
    ((bytes[offset + 2] ?? 0) << 8) |
    (bytes[offset + 3] ?? 0)
  );
}

function readBigEndian16(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

// The PNG header: signature, then the IHDR chunk whose first two fields are the dimensions. Fixed
// offsets, because IHDR is required to be the first chunk.
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.byteLength < 24) return undefined;
  const chunkType = String.fromCharCode(...bytes.slice(12, 16));
  if (chunkType !== "IHDR") return undefined;
  return { width: readBigEndian32(bytes, 16), height: readBigEndian32(bytes, 20) };
}

// JPEG has no header field for its size — the dimensions live in whichever start-of-frame marker the
// encoder used, after an arbitrary run of metadata segments. The walk is bounded by the buffer and by a
// segment-length sanity check, so a malformed file terminates with "unreadable" rather than looping.
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 3 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1] ?? 0;
    // Padding between segments is written as repeated 0xFF; skip one byte and re-read.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers carry no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }
    const length = readBigEndian16(bytes, offset + 2);
    if (length < 2) return undefined;
    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame) {
      if (offset + 9 > bytes.byteLength) return undefined;
      return {
        height: readBigEndian16(bytes, offset + 5),
        width: readBigEndian16(bytes, offset + 7),
      };
    }
    offset += 2 + length;
  }
  return undefined;
}

export function readImageFacts(bytes: Uint8Array): Outcome<ImageFacts, ImageFormatFailure> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return failed(
      "image-oversize",
      `an image may be at most ${MAX_IMAGE_BYTES} bytes; this one is ${bytes.byteLength}`,
    );
  }
  const png = startsWithSignature(bytes, PNG_SIGNATURE);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpeg) {
    return failed(
      "unsupported-image-format",
      "a letterhead logo has to be a PNG or a JPEG. Those are the two formats every word processor draws identically and neither of them is a document that can carry markup or a script.",
    );
  }
  const dimensions = png ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (dimensions === undefined) {
    return failed(
      "image-unreadable",
      "the file begins like an image but its width and height could not be read, so there is no way to know how large to draw it",
    );
  }
  const { width, height } = dimensions;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_IMAGE_PIXELS ||
    height > MAX_IMAGE_PIXELS
  ) {
    return failed(
      "image-unreadable",
      `the image reports a size of ${width} by ${height} pixels, which is not a size a letterhead mark can have`,
    );
  }
  return succeeded(
    png
      ? { contentType: "image/png", extension: "png", widthPixels: width, heightPixels: height }
      : { contentType: "image/jpeg", extension: "jpeg", widthPixels: width, heightPixels: height },
  );
}

// ---------------------------------------------------------------------------------------------
// The box
// ---------------------------------------------------------------------------------------------

// English Metric Units — the integer unit every OOXML drawing measurement is expressed in. 914400 to the
// inch by definition, and a word processor's own notion of a pixel is 96 to the inch, so an image's
// intrinsic pixel size converts exactly with no rounding anywhere.
export const EMU_PER_INCH = 914400;
export const EMU_PER_PIXEL = EMU_PER_INCH / 96;

export function emuFromPixels(pixels: number): number {
  return pixels * EMU_PER_PIXEL;
}

// The height that keeps the asset's own proportions at a chosen width. THE ASPECT RATIO IS NOT A CHOICE:
// a firm's mark has one shape, and a document that could set width and height independently is a
// document that can print a stretched logo — which looks like a defect in the product rather than in the
// template. Integer arithmetic throughout, because EMU are integers and a fractional one is not a length
// any reader accepts.
export function heightForWidth(facts: ImageFacts, widthEmu: number): number {
  return Math.max(1, Math.round((widthEmu * facts.heightPixels) / facts.widthPixels));
}

// ---------------------------------------------------------------------------------------------
// The package edits
// ---------------------------------------------------------------------------------------------

const RELATIONSHIPS_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships";
const IMAGE_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const RELATIONSHIPS_CONTENT_TYPE = "application/vnd.openxmlformats-package.relationships+xml";
const CONTENT_TYPES_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/content-types";

export const MEDIA_DIRECTORY = "word/media/";

// The `<Default Extension="…">` declarations a package already carries. A picture whose extension is not
// declared is a part with no content type, which is exactly the shape of an invalid package.
function declaredDefaultExtensions(parts: PartMap): Set<string> {
  const xml = readPartText(parts, CONTENT_TYPES_PART) ?? "";
  const extensions = new Set<string>();
  for (const match of xml.matchAll(/<Default\s[^>]*Extension\s*=\s*"([^"]+)"/g)) {
    const extension = match[1];
    if (extension !== undefined) extensions.add(extension.toLowerCase());
  }
  return extensions;
}

// Declare an extension's content type, if the package does not already. Appended to the existing
// declarations rather than rewritten over them: the package's own Overrides and Defaults are the
// authoring application's, and this pass adds one line to them.
export function declareDefaultContentType(
  parts: PartMap,
  extension: string,
  contentType: string,
): void {
  if (declaredDefaultExtensions(parts).has(extension.toLowerCase())) return;
  const xml = readPartText(parts, CONTENT_TYPES_PART);
  if (xml === undefined) return;
  const nodes = parseXml(xml);
  const root = nodes.find((node) => nodeTag(node) === "Types");
  if (root === undefined) return;
  const children = root["Types"];
  if (!Array.isArray(children)) return;
  // Defaults precede Overrides in every package an authoring application writes, and while the schema
  // does not require it, keeping the order means a rewritten package still diffs against the original.
  const firstOverride = (children as XmlNode[]).findIndex((node) => nodeTag(node) === "Override");
  const declaration: XmlNode = {
    Default: [],
    ":@": { "@_Extension": extension, "@_ContentType": contentType },
  };
  const inserted = [...(children as XmlNode[])];
  inserted.splice(firstOverride === -1 ? inserted.length : firstOverride, 0, declaration);
  root["Types"] = inserted;
  // The package-level namespace lives on the root and every authoring application writes it; restating it
  // when it is absent keeps a hand-built fixture from producing a part no reader will open.
  const attributes = attributesOf(root);
  if (attributes["@_xmlns"] === undefined) {
    root[":@"] = { ...attributes, "@_xmlns": CONTENT_TYPES_NAMESPACE };
  }
  writePartText(parts, CONTENT_TYPES_PART, buildXml(nodes));
}

const EMPTY_RELATIONSHIPS = `<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"></Relationships>`;

// Add an image relationship to the part that will draw it and return the id to reference it by.
//
// Relationship ids are LOCAL TO A PART: `rId4` in the main document and `rId4` in a header are different
// relationships, so the next free id is computed per relationship part rather than once per package. The
// scan is over the ids actually present, never a count — a package whose authoring application deleted a
// relationship has gaps, and numbering from the count would reuse a live id.
export function addImageRelationship(parts: PartMap, contentPart: string, target: string): string {
  const relationshipPart = relationshipPartFor(contentPart);
  const xml = readPartText(parts, relationshipPart) ?? EMPTY_RELATIONSHIPS;
  const nodes = parseXml(xml);
  const root = nodes.find((node) => nodeTag(node) === "Relationships");
  if (root === undefined) return "";
  const children = Array.isArray(root["Relationships"]) ? (root["Relationships"] as XmlNode[]) : [];

  let highest = 0;
  for (const child of children) {
    const id = attributesOf(child)["@_Id"];
    const digits = typeof id === "string" ? /^rId(\d+)$/.exec(id) : null;
    if (digits !== null) highest = Math.max(highest, Number(digits[1]));
  }
  const relationshipId = `rId${highest + 1}`;

  root["Relationships"] = [
    ...children,
    {
      Relationship: [],
      ":@": {
        "@_Id": relationshipId,
        "@_Type": IMAGE_RELATIONSHIP_TYPE,
        "@_Target": target,
      },
    },
  ];
  const attributes = attributesOf(root);
  if (attributes["@_xmlns"] === undefined) {
    root[":@"] = { ...attributes, "@_xmlns": RELATIONSHIPS_NAMESPACE };
  }
  writePartText(parts, relationshipPart, buildXml(nodes));
  // A relationship part is itself a part, so its own extension has to be declared or the package it
  // belongs to is invalid. Every real `.docx` already declares it; a hand-built one may not.
  declareDefaultContentType(parts, "rels", RELATIONSHIPS_CONTENT_TYPE);
  return relationshipId;
}

// A relationship's Target as the part that draws it has to spell it: relative to that part's own
// directory when they share one, and package-absolute otherwise. Getting this wrong produces a
// relationship that resolves to a part that is not there — a document that opens with a red X where the
// picture should be, which no assertion over the document's text can see.
export function relationshipTargetFor(contentPart: string, mediaPart: string): string {
  const directory = contentPart.slice(0, contentPart.lastIndexOf("/") + 1);
  return directory !== "" && mediaPart.startsWith(directory)
    ? mediaPart.slice(directory.length)
    : `/${mediaPart}`;
}

// Write the image bytes into the package under a name nothing else holds, and return the part name.
// Content-addressed by the caller's chosen base name plus a counter rather than by hash, so a package
// rewritten twice from the same template and the same asset produces byte-identical output — the
// reproducibility property the whole engine keeps.
export function addImagePart(
  parts: PartMap,
  baseName: string,
  facts: ImageFacts,
  bytes: Uint8Array,
): string {
  let ordinal = 1;
  let partName = `${MEDIA_DIRECTORY}${baseName}${ordinal}.${facts.extension}`;
  while (parts.has(partName)) {
    ordinal += 1;
    partName = `${MEDIA_DIRECTORY}${baseName}${ordinal}.${facts.extension}`;
  }
  parts.set(partName, bytes);
  declareDefaultContentType(parts, facts.extension, facts.contentType);
  return partName;
}

// ---------------------------------------------------------------------------------------------
// The drawing
// ---------------------------------------------------------------------------------------------

const WORDPROCESSING_DRAWING_NAMESPACE =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const DRAWING_NAMESPACE = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PICTURE_NAMESPACE = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const OFFICE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export interface InlineDrawingInput {
  readonly relationshipId: string;
  readonly widthEmu: number;
  readonly heightEmu: number;
  // What a screen reader announces and what Word shows in the picture's properties. A logo with no
  // alternative text is an accessibility defect in every document the firm ever files.
  readonly description: string;
  // Unique within the part. Word tolerates duplicates; strict consumers and accessibility checkers do
  // not, so each drawing in a part gets its own.
  readonly drawingId: number;
  readonly name: string;
}

// One inline picture, as a `w:drawing` node.
//
// EVERY NAMESPACE IS DECLARED ON THE ELEMENT THAT USES IT rather than assumed on the part's root. A
// template's `w:hdr` may declare `w:` and nothing else — it never needed a drawing before — and a
// prefix used but not bound is not well-formed XML, which is a document no reader opens and nothing in a
// text assertion catches.
export function inlineDrawingNode(input: InlineDrawingInput): XmlNode {
  const extent: XmlNode = {
    "wp:extent": [],
    ":@": { "@_cx": String(input.widthEmu), "@_cy": String(input.heightEmu) },
  };
  const documentProperties: XmlNode = {
    "wp:docPr": [],
    ":@": {
      "@_id": String(input.drawingId),
      "@_name": input.name,
      "@_descr": input.description,
    },
  };
  const frameProperties: XmlNode = {
    "wp:cNvGraphicFramePr": [
      {
        "a:graphicFrameLocks": [],
        ":@": { "@_xmlns:a": DRAWING_NAMESPACE, "@_noChangeAspect": "1" },
      },
    ],
  };
  const picture: XmlNode = {
    "pic:pic": [
      {
        "pic:nvPicPr": [
          {
            "pic:cNvPr": [],
            ":@": { "@_id": "0", "@_name": input.name, "@_descr": input.description },
          },
          { "pic:cNvPicPr": [] },
        ],
      },
      {
        "pic:blipFill": [
          {
            "a:blip": [],
            ":@": {
              "@_xmlns:r": OFFICE_RELATIONSHIPS_NAMESPACE,
              "@_r:embed": input.relationshipId,
            },
          },
          { "a:stretch": [{ "a:fillRect": [] }] },
        ],
      },
      {
        "pic:spPr": [
          {
            "a:xfrm": [
              { "a:off": [], ":@": { "@_x": "0", "@_y": "0" } },
              {
                "a:ext": [],
                ":@": { "@_cx": String(input.widthEmu), "@_cy": String(input.heightEmu) },
              },
            ],
          },
          { "a:prstGeom": [{ "a:avLst": [] }], ":@": { "@_prst": "rect" } },
        ],
      },
    ],
    ":@": { "@_xmlns:pic": PICTURE_NAMESPACE },
  };
  const graphic: XmlNode = {
    "a:graphic": [
      {
        "a:graphicData": [picture],
        ":@": { "@_uri": PICTURE_NAMESPACE },
      },
    ],
    ":@": { "@_xmlns:a": DRAWING_NAMESPACE },
  };
  return {
    "w:drawing": [
      {
        "wp:inline": [extent, documentProperties, frameProperties, graphic],
        ":@": {
          "@_xmlns:wp": WORDPROCESSING_DRAWING_NAMESPACE,
          "@_distT": "0",
          "@_distB": "0",
          "@_distL": "0",
          "@_distR": "0",
        },
      },
    ],
  };
}

// Every `r:embed` a part references, so an integrity check can prove each one resolves to a relationship
// that part actually declares. A dangling embed is the single most common way a hand-emitted picture
// produces a file Word calls damaged.
export function embeddedRelationshipIds(xml: string): string[] {
  return [...xml.matchAll(/r:embed\s*=\s*"([^"]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

// Every relationship a relationship part declares, as id to resolved target part name. Targets are
// relative to the OWNING PART'S DIRECTORY, which is why resolution needs the content part's name and not
// just the relationship part's contents.
export function declaredRelationships(
  parts: PartMap,
  contentPart: string,
): Map<string, { readonly id: string; readonly target: string; readonly external: boolean }> {
  const xml = readPartText(parts, relationshipPartFor(contentPart)) ?? "";
  const directory = contentPart.slice(0, contentPart.lastIndexOf("/") + 1);
  const relationships = new Map<
    string,
    { readonly id: string; readonly target: string; readonly external: boolean }
  >();
  for (const match of xml.matchAll(/<Relationship\s[^>]*\/?>/g)) {
    const element = match[0];
    const id = /\bId\s*=\s*"([^"]+)"/.exec(element)?.[1];
    const target = /\bTarget\s*=\s*"([^"]+)"/.exec(element)?.[1];
    if (id === undefined || target === undefined) continue;
    const external = /\bTargetMode\s*=\s*"External"/.test(element);
    relationships.set(id, {
      id,
      target: external ? target : resolveTarget(directory, target),
      external,
    });
  }
  return relationships;
}

// A relationship target resolved against the owning part's directory: `media/logo1.png` from
// `word/header1.xml` is `word/media/logo1.png`, and a leading slash means package-absolute.
function resolveTarget(directory: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = `${directory}${target}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }
  return resolved.join("/");
}
