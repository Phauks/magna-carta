import { describe, expect, it } from "vitest";
import {
  assessInlinePlayable,
  isPlayabilityCandidate,
  MOVIE_TABLE_CEILING_BYTES,
  type ByteRangeReader,
} from "../src/inline-playable.ts";

// Every fixture is built here from its structure, so each test states exactly which box or element
// it is about and nothing rides on a binary checked in beside it.

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function box(type: string, ...content: readonly Uint8Array[]): Uint8Array {
  const body = concatenate(...content);
  return concatenate(uint32(body.length + 8), ascii(type), body);
}

/** A track whose handler is `handler` and whose first sample entry is `codec`. */
function track(handler: string, codec: string): Uint8Array {
  const handlerBox = box(
    "hdlr",
    new Uint8Array(4),
    new Uint8Array(4),
    ascii(handler),
    new Uint8Array(12),
  );
  const sampleEntry = box(codec, new Uint8Array(8));
  const descriptions = box("stsd", new Uint8Array(4), uint32(1), sampleEntry);
  return box(
    "trak",
    box("tkhd", new Uint8Array(84)),
    box("mdia", handlerBox, box("minf", box("stbl", descriptions))),
  );
}

function movie(...tracks: readonly Uint8Array[]): Uint8Array {
  return box("moov", box("mvhd", new Uint8Array(100)), ...tracks);
}

const fileTypeBox = box("ftyp", ascii("isom"), uint32(512), ascii("isomavc1"));

function memoryReader(bytes: Uint8Array): ByteRangeReader & { readonly reads: number[] } {
  const reads: number[] = [];
  return {
    size: bytes.length,
    reads,
    async read(offset, length) {
      reads.push(length);
      return bytes.slice(offset, Math.min(bytes.length, offset + length));
    },
  };
}

describe("isPlayabilityCandidate", () => {
  it("reads only the video containers a browser could play", () => {
    expect(isPlayabilityCandidate("video/mp4")).toBe(true);
    expect(isPlayabilityCandidate("video/webm")).toBe(true);
    expect(isPlayabilityCandidate("video/quicktime")).toBe(true);
    expect(isPlayabilityCandidate("video/x-msvideo")).toBe(false);
    expect(isPlayabilityCandidate("application/pdf")).toBe(false);
    expect(isPlayabilityCandidate(null)).toBe(false);
  });
});

describe("assessInlinePlayable, MP4 and QuickTime", () => {
  it("plays H.264 video with AAC sound", async () => {
    const file = concatenate(
      fileTypeBox,
      movie(track("vide", "avc1"), track("soun", "mp4a")),
      box("mdat", new Uint8Array(64)),
    );
    expect(await assessInlinePlayable("video/mp4", memoryReader(file))).toBe("playable");
  });

  it("finds the track table after the media, reading headers rather than the media itself", async () => {
    const media = box("mdat", new Uint8Array(200_000));
    const file = concatenate(fileTypeBox, media, movie(track("vide", "avc1")));
    const reader = memoryReader(file);
    expect(await assessInlinePlayable("video/mp4", reader)).toBe("playable");
    expect(Math.max(...reader.reads)).toBeLessThan(media.length);
  });

  it("offers HEVC, which a phone records, to the browser to try", async () => {
    const file = concatenate(fileTypeBox, movie(track("vide", "hvc1"), track("soun", "mp4a")));
    expect(await assessInlinePlayable("video/quicktime", memoryReader(file))).toBe("playable");
    const tagged = concatenate(fileTypeBox, movie(track("vide", "hev1")));
    expect(await assessInlinePlayable("video/mp4", memoryReader(tagged))).toBe("playable");
  });

  it("offers ProRes, which no browser decodes, as a download", async () => {
    const file = concatenate(fileTypeBox, movie(track("vide", "apch"), track("soun", "mp4a")));
    expect(await assessInlinePlayable("video/quicktime", memoryReader(file))).toBe("download-only");
  });

  it("refuses the whole file when one sound track is in a codec browsers lack", async () => {
    const file = concatenate(fileTypeBox, movie(track("vide", "avc1"), track("soun", "ac-3")));
    expect(await assessInlinePlayable("video/mp4", memoryReader(file))).toBe("download-only");
  });

  it("ignores tracks that are neither picture nor sound, such as a timecode track", async () => {
    const file = concatenate(fileTypeBox, movie(track("vide", "avc1"), track("tmcd", "tmcd")));
    expect(await assessInlinePlayable("video/quicktime", memoryReader(file))).toBe("playable");
  });

  it("cannot judge a file with no track table", async () => {
    const file = concatenate(fileTypeBox, box("mdat", new Uint8Array(32)));
    expect(await assessInlinePlayable("video/mp4", memoryReader(file))).toBe("indeterminate");
  });

  it("cannot judge a box whose declared size runs past the end of the file", async () => {
    const file = concatenate(fileTypeBox, uint32(10_000), ascii("moov"), new Uint8Array(16));
    expect(await assessInlinePlayable("video/mp4", memoryReader(file))).toBe("indeterminate");
  });

  it("declines a track table past the ceiling rather than reading it into memory", async () => {
    const oversized = concatenate(uint32(MOVIE_TABLE_CEILING_BYTES + 16), ascii("moov"));
    const reader: ByteRangeReader = {
      size: MOVIE_TABLE_CEILING_BYTES * 2,
      async read(offset, length) {
        if (offset === 0) return fileTypeBox.slice(0, length);
        if (offset === fileTypeBox.length) return oversized.slice(0, length);
        throw new Error(`unexpected read at ${offset}`);
      },
    };
    expect(await assessInlinePlayable("video/mp4", reader)).toBe("indeterminate");
  });
});

// ---- WebM --------------------------------------------------------------------------------------

function ebmlSize(length: number): Uint8Array {
  // Eight-byte sizes throughout: valid, and simple to write.
  const bytes = new Uint8Array(8);
  bytes[0] = 0x01;
  let remaining = length;
  for (let index = 7; index >= 1; index--) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  return bytes;
}

function ebmlIdentifier(id: number): Uint8Array {
  const bytes: number[] = [];
  let remaining = id;
  while (remaining > 0) {
    bytes.unshift(remaining % 256);
    remaining = Math.floor(remaining / 256);
  }
  return new Uint8Array(bytes);
}

function element(id: number, ...content: readonly Uint8Array[]): Uint8Array {
  const body = concatenate(...content);
  return concatenate(ebmlIdentifier(id), ebmlSize(body.length), body);
}

function webmTrack(type: number, codec: string): Uint8Array {
  return element(
    0xae,
    element(0xd7, new Uint8Array([1])),
    element(0x83, new Uint8Array([type])),
    element(0x86, ascii(codec)),
  );
}

function webm(documentType: string, ...tracks: readonly Uint8Array[]): Uint8Array {
  const header = element(
    0x1a45dfa3,
    element(0x4286, new Uint8Array([1])),
    element(0x4282, ascii(documentType)),
  );
  const information = element(0x1549a966, element(0x2ad7b1, new Uint8Array([0x0f, 0x42, 0x40])));
  const segment = element(
    0x18538067,
    information,
    element(0x1654ae6b, ...tracks),
    element(0x1f43b675, new Uint8Array(64)),
  );
  return concatenate(header, segment);
}

describe("assessInlinePlayable, WebM", () => {
  it("plays VP9 video with Opus sound", async () => {
    const file = webm("webm", webmTrack(1, "V_VP9"), webmTrack(2, "A_OPUS"));
    expect(await assessInlinePlayable("video/webm", memoryReader(file))).toBe("playable");
  });

  it("judges a Matroska file by the codecs it carries", async () => {
    const file = webm("matroska", webmTrack(1, "V_MPEG4/ISO/AVC"), webmTrack(2, "A_AAC/MPEG4/LC"));
    expect(await assessInlinePlayable("video/x-matroska", memoryReader(file))).toBe("playable");
    const hevc = webm("matroska", webmTrack(1, "V_MPEGH/ISO/HEVC"), webmTrack(2, "A_OPUS"));
    expect(await assessInlinePlayable("video/x-matroska", memoryReader(hevc))).toBe("playable");
  });

  it("offers a recording whose sound a browser would drop as a download", async () => {
    const file = webm("matroska", webmTrack(1, "V_MPEG4/ISO/AVC"), webmTrack(2, "A_AC3"));
    expect(await assessInlinePlayable("video/x-matroska", memoryReader(file))).toBe(
      "download-only",
    );
  });

  it("offers a codec no browser decodes as a download", async () => {
    const file = webm("matroska", webmTrack(1, "V_MPEG2"));
    expect(await assessInlinePlayable("video/x-matroska", memoryReader(file))).toBe(
      "download-only",
    );
  });

  it("cannot judge a file whose media begins before any track list", async () => {
    const header = element(0x1a45dfa3, element(0x4282, ascii("webm")));
    const file = concatenate(header, element(0x18538067, element(0x1f43b675, new Uint8Array(32))));
    expect(await assessInlinePlayable("video/webm", memoryReader(file))).toBe("indeterminate");
  });
});
