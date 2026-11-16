import { zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { FieldCollector } from "../src/fields.ts";
import { readExif } from "../src/image/exif.ts";
import { inspectJpegFindings } from "../src/image/jpeg.ts";
import { inspectPngFindings } from "../src/image/png.ts";
import { readXmp } from "../src/image/xmp.ts";
import type { Finding, FindingField } from "../src/model.ts";

// ---- A little-endian TIFF builder: directories of entries, values laid out after them. ----

type Value =
  | { type: "ascii"; text: string }
  | { type: "short"; values: number[] }
  | { type: "long"; values: number[] }
  | { type: "rational"; values: [number, number][] };

interface Directory {
  entries: [number, Value][];
}

const TYPE_CODE = { ascii: 2, short: 3, long: 4, rational: 5 } as const;

function valueBytes(value: Value): number[] {
  if (value.type === "ascii") return [...Array.from(value.text, (c) => c.charCodeAt(0)), 0];
  if (value.type === "short") return value.values.flatMap((v) => [v & 0xff, (v >> 8) & 0xff]);
  if (value.type === "long") return value.values.flatMap((v) => le32(v));
  return value.values.flatMap(([n, d]) => [...le32(n), ...le32(d)]);
}

function valueCount(value: Value): number {
  return value.type === "ascii" ? value.text.length + 1 : value.values.length;
}

function le32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

// Lays out IFD0 at 8, then each further directory; a "long" value of -1 under the EXIF or GPS
// pointer tag is replaced with that directory's offset.
function buildTiff(first: Directory, exif?: Directory, gps?: Directory): Uint8Array {
  const directories = [first, exif, gps].filter((d): d is Directory => d !== undefined);
  const sizeOf = (d: Directory) =>
    2 +
    d.entries.length * 12 +
    4 +
    d.entries.reduce((sum, [, v]) => {
      const length = valueBytes(v).length;
      return sum + (length > 4 ? length + (length % 2) : 0);
    }, 0);
  const offsets: number[] = [];
  let cursor = 8;
  for (const d of directories) {
    offsets.push(cursor);
    cursor += sizeOf(d);
  }
  const pointerFor = (tag: number): number | undefined => {
    if (tag === 0x8769 && exif !== undefined) return offsets[directories.indexOf(exif)];
    if (tag === 0x8825 && gps !== undefined) return offsets[directories.indexOf(gps)];
    return undefined;
  };
  const out: number[] = [0x49, 0x49, 42, 0, ...le32(8)];
  directories.forEach((d, index) => {
    const start = offsets[index] ?? 0;
    let data = start + 2 + d.entries.length * 12 + 4;
    const tail: number[] = [];
    out.push(d.entries.length & 0xff, d.entries.length >> 8);
    for (const [tag, raw] of d.entries) {
      const pointer = pointerFor(tag);
      const value: Value = pointer === undefined ? raw : { type: "long", values: [pointer] };
      const bytes = valueBytes(value);
      out.push(tag & 0xff, tag >> 8, TYPE_CODE[value.type], 0, ...le32(valueCount(value)));
      if (bytes.length <= 4) {
        out.push(...bytes, ...Array(4 - bytes.length).fill(0));
      } else {
        out.push(...le32(data));
        tail.push(...bytes);
        if (bytes.length % 2 === 1) tail.push(0);
        data += bytes.length + (bytes.length % 2);
      }
    }
    out.push(0, 0, 0, 0, ...tail);
  });
  return new Uint8Array(out);
}

const POINTER: Value = { type: "long", values: [0] };

function cameraTiff(withOffset: boolean): Uint8Array {
  return buildTiff(
    {
      entries: [
        [0x010f, { type: "ascii", text: "Canon" }],
        [0x0110, { type: "ascii", text: "EOS R5" }],
        [0x0131, { type: "ascii", text: "Lightroom" }],
        [0x8769, POINTER],
        [0x8825, POINTER],
      ],
    },
    {
      entries: [
        [0x9003, { type: "ascii", text: "2026:10:02 14:31:07" }],
        ...(withOffset ? ([[0x9011, { type: "ascii", text: "-04:00" }]] as [number, Value][]) : []),
        [0xa431, { type: "ascii", text: "SN-0412" }],
      ],
    },
    {
      entries: [
        [1, { type: "ascii", text: "N" }],
        [
          2,
          {
            type: "rational",
            values: [
              [40, 1],
              [42, 1],
              [4608, 100],
            ],
          },
        ],
        [3, { type: "ascii", text: "W" }],
        [
          4,
          {
            type: "rational",
            values: [
              [74, 1],
              [0, 1],
              [2160, 100],
            ],
          },
        ],
      ],
    },
  );
}

function named(
  fields: readonly FindingField[] | undefined,
  name: string,
): FindingField | undefined {
  return fields?.find((field) => field.name === name);
}

function read(tiff: Uint8Array): readonly FindingField[] {
  const collector = new FieldCollector();
  readExif(tiff, collector);
  const finding: Finding = {
    category: "image-location",
    label: "",
    risk: "high",
    count: 1,
    defaultScrub: true,
  };
  return collector.attachTo(finding).fields ?? [];
}

describe("EXIF values", () => {
  it("reads the camera, the location and the moment it was taken", () => {
    const fields = read(cameraTiff(true));
    expect(named(fields, "Camera Make")?.value).toEqual({ form: "text", text: "Canon" });
    expect(named(fields, "Camera Model")?.value).toEqual({ form: "text", text: "EOS R5" });
    expect(named(fields, "Camera Serial Number")?.value).toEqual({ form: "text", text: "SN-0412" });
    expect(named(fields, "Location")?.value).toEqual({
      form: "text",
      text: "40.712800, -74.006000",
    });
    expect(named(fields, "Taken")?.value).toEqual({
      form: "instant",
      instant: "2026-10-02T18:31:07.000Z",
    });
    expect(fields[0]?.name).toBe("Location");
  });

  it("keeps a camera clock with no offset as the time it was set to", () => {
    expect(named(read(cameraTiff(false)), "Taken")?.value).toEqual({
      form: "zoneless",
      date: "2026-10-02",
      time: "14:31",
    });
  });

  it("reads nothing from bytes that are not a TIFF structure, and never throws", () => {
    expect(read(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual([]);
    const tiff = cameraTiff(true);
    for (let length = 0; length < tiff.length; length += 7) {
      expect(() => read(tiff.subarray(0, length))).not.toThrow();
    }
  });

  it("does not loop on a directory that points at itself", () => {
    const tiff = buildTiff({ entries: [[0x8769, { type: "long", values: [8] }]] });
    expect(read(tiff)).toEqual([]);
  });
});

describe("XMP values", () => {
  it("reads attributes, elements and lists", () => {
    const collector = new FieldCollector();
    readXmp(
      '<x:xmpmeta><rdf:RDF><rdf:Description xmp:CreatorTool="Adobe Photoshop 27.0" xmp:CreateDate="2026-10-01T09:00:00-04:00"><dc:creator><rdf:Seq><rdf:li>Jordan Alvarez</rdf:li><rdf:li>M. Chen</rdf:li></rdf:Seq></dc:creator><xmpMM:DocumentID>xmp.did:abc &amp; def</xmpMM:DocumentID></rdf:Description></rdf:RDF></x:xmpmeta>',
      collector,
    );
    const fields = collector.attachTo({
      category: "image-software",
      label: "",
      risk: "medium",
      count: 1,
      defaultScrub: true,
    }).fields;
    expect(named(fields, "Software")?.value).toEqual({
      form: "text",
      text: "Adobe Photoshop 27.0",
    });
    expect(named(fields, "Author")?.value).toEqual({
      form: "text",
      text: "Jordan Alvarez; M. Chen",
    });
    expect(named(fields, "Created")?.value).toEqual({
      form: "instant",
      instant: "2026-10-01T13:00:00.000Z",
    });
    expect(named(fields, "Document Identifier")?.value).toEqual({
      form: "text",
      text: "xmp.did:abc & def",
    });
  });

  it("finishes quickly on a packet of unclosed openings", () => {
    const collector = new FieldCollector();
    const started = performance.now();
    readXmp(`${"<dc:creator ".repeat(20000)}${"<".repeat(100000)}`, collector);
    expect(performance.now() - started).toBeLessThan(2000);
    expect(collector.size).toBe(0);
  });
});

// ---- Images ----

function segment(marker: number, payload: number[] | Uint8Array): number[] {
  const bytes = Array.from(payload);
  const length = bytes.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...bytes];
}

function ascii(text: string): number[] {
  return Array.from(text, (c) => c.charCodeAt(0));
}

function jpegWith(...segments: number[][]): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    ...segments.flat(),
    0xff,
    0xda,
    0x00,
    0x03,
    0x00,
    0x11,
    0x22,
    0xff,
    0xd9,
  ]);
}

function findingIn(findings: Finding[], category: Finding["category"]): Finding | undefined {
  return findings.find((finding) => finding.category === category);
}

describe("JPEG values", () => {
  it("puts EXIF values on the location finding and a comment on the other finding", () => {
    const findings = inspectJpegFindings(
      jpegWith(
        segment(0xe1, [...ascii("Exif\0\0"), ...cameraTiff(true)]),
        segment(0xfe, ascii("Shot for the Alvarez matter")),
      ),
    );
    expect(named(findingIn(findings, "image-location")?.fields, "Camera Make")?.value).toEqual({
      form: "text",
      text: "Canon",
    });
    expect(named(findingIn(findings, "image-other")?.fields, "Comment")?.value).toEqual({
      form: "text",
      text: "Shot for the Alvarez matter",
    });
  });

  it("reads the IPTC record in a Photoshop segment", () => {
    const iptc = [
      28,
      2,
      80,
      0,
      14,
      ...ascii("Jordan Alvarez"),
      28,
      2,
      90,
      0,
      8,
      ...ascii("New York"),
      28,
      2,
      55,
      0,
      8,
      ...ascii("20261002"),
    ];
    const resource = [
      ...ascii("8BIM"),
      0x04,
      0x04,
      0,
      0, // empty Pascal name, padded to even
      0,
      0,
      0,
      iptc.length,
      ...iptc,
      ...(iptc.length % 2 === 1 ? [0] : []),
    ];
    const findings = inspectJpegFindings(
      jpegWith(segment(0xed, [...ascii("Photoshop 3.0\0"), ...resource])),
    );
    const fields = findingIn(findings, "image-software")?.fields;
    expect(named(fields, "Author")?.value).toEqual({ form: "text", text: "Jordan Alvarez" });
    expect(named(fields, "City")?.value).toEqual({ form: "text", text: "New York" });
    expect(named(fields, "Created")?.value).toEqual({ form: "zoneless", date: "2026-10-02" });
  });
});

function chunk(type: string, data: number[] | Uint8Array): number[] {
  const bytes = Array.from(data);
  const length = bytes.length;
  return [
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
    ...ascii(type),
    ...bytes,
    0,
    0,
    0,
    0, // the checksum is not read
  ];
}

function pngWith(...chunks: number[][]): Uint8Array {
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", Array(13).fill(0)),
    ...chunks.flat(),
    ...chunk("IEND", []),
  ]);
}

describe("PNG values", () => {
  it("reads plain, compressed and international text, the modification time and EXIF", () => {
    const findings = inspectPngFindings(
      pngWith(
        chunk("tEXt", [...ascii("Author\0"), ...ascii("Jordan Alvarez")]),
        chunk("zTXt", [
          ...ascii("Comment\0"),
          0,
          ...zlibSync(new Uint8Array(ascii("Draft for M. Chen"))),
        ]),
        chunk("iTXt", [
          ...ascii("Title\0"),
          0,
          0,
          ...ascii("en\0"),
          0,
          ...new TextEncoder().encode("Site Photo"),
        ]),
        chunk("tIME", [0x07, 0xea, 10, 2, 14, 31, 7]),
        chunk("eXIf", cameraTiff(false)),
      ),
    );
    const other = findingIn(findings, "image-other")?.fields;
    expect(named(other, "Author")?.value).toEqual({ form: "text", text: "Jordan Alvarez" });
    expect(named(other, "Comment")?.value).toEqual({ form: "text", text: "Draft for M. Chen" });
    expect(named(other, "Title")?.value).toEqual({ form: "text", text: "Site Photo" });
    expect(named(other, "Modified")?.value).toEqual({
      form: "instant",
      instant: "2026-10-02T14:31:07.000Z",
    });
    expect(named(findingIn(findings, "image-location")?.fields, "Camera Model")?.value).toEqual({
      form: "text",
      text: "EOS R5",
    });
  });

  it("cuts a compressed text chunk that inflates past the cap", () => {
    const huge = zlibSync(new Uint8Array(8 * 1024 * 1024).fill(0x41));
    const findings = inspectPngFindings(
      pngWith(chunk("zTXt", [...ascii("Comment\0"), 0, ...huge])),
    );
    const value = named(findingIn(findings, "image-other")?.fields, "Comment")?.value;
    expect(value?.form === "text" && value.text.endsWith("…")).toBe(true);
  });
});
