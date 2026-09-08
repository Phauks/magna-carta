// Which archive a stored object actually is, decided from its own first bytes.
//
// WHY THE BYTES AND NOT THE NAME. A name is a claim and a sniffed content type is a reading of the
// same bytes made at ingest, when the archive may have been named `.zip` by whoever sent it. Every
// one of these formats begins with a signature it cannot forge without ceasing to be that format,
// so the cheapest honest answer is to read sixteen bytes off the front and ask them.
//
// The one format whose signature is not at the front is tar, which has no header at all: its first
// member's header IS the start of the file, and the only reliable marker is the `ustar` magic
// sitting at offset 257. That is still one ranged read, and it is checked last so no other format
// can be mistaken for it.
//
// LISTING IS NOT EXTRACTING, and this seam exists because the two have different costs. Every
// format here can be listed from a header without inflating a byte of content, so a reader can see
// what an archive holds however it was packed — even where taking a member out is not something
// this platform can do.

/** An archive format this platform can read the contents list of. */
export type ArchiveFormat = "zip" | "tar" | "sevenZip" | "rar";

/** How many bytes of the front the sniff needs. tar's magic sits at offset 257. */
export const ARCHIVE_SNIFF_BYTES = 264;

const SIGNATURES: readonly { readonly format: ArchiveFormat; readonly bytes: readonly number[] }[] =
  [
    // "PK\x03\x04" — a local file header. "PK\x05\x06" and "PK\x07\x08" are an empty and a spanned
    // archive respectively, and both are still zips to the central-directory reader.
    { format: "zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
    { format: "zip", bytes: [0x50, 0x4b, 0x05, 0x06] },
    { format: "zip", bytes: [0x50, 0x4b, 0x07, 0x08] },
    // "7z\xbc\xaf\x27\x1c".
    { format: "sevenZip", bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
    // "Rar!\x1a\x07\x01\x00" is RAR5; the same without the trailing 0x01 0x00 is RAR4. The longer
    // one is tested first so a RAR5 archive is never reported as RAR4.
    { format: "rar", bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00] },
    { format: "rar", bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00] },
  ];

/** Where tar's `ustar` magic sits, and what it reads. */
const TAR_MAGIC_OFFSET = 257;
const TAR_MAGICS: readonly (readonly number[])[] = [
  // "ustar\0" — POSIX.
  [0x75, 0x73, 0x74, 0x61, 0x72, 0x00],
  // "ustar  " — the GNU spelling, two spaces where POSIX has a NUL and a version.
  [0x75, 0x73, 0x74, 0x61, 0x72, 0x20, 0x20],
];

function startsWith(head: Uint8Array, at: number, bytes: readonly number[]): boolean {
  if (at + bytes.length > head.byteLength) return false;
  return bytes.every((byte, index) => head[at + index] === byte);
}

/**
 * The archive format these bytes are, or null when they are not an archive this platform reads.
 *
 * Takes the head of the object — `ARCHIVE_SNIFF_BYTES` is enough for every case — so the caller
 * makes one ranged read and never fetches the archive to find out what it is.
 */
export function archiveFormatOf(head: Uint8Array): ArchiveFormat | null {
  for (const signature of SIGNATURES) {
    if (startsWith(head, 0, signature.bytes)) return signature.format;
  }
  // tar last: it has no signature of its own at offset 0, so anything that reached here has already
  // failed every format that does.
  for (const magic of TAR_MAGICS) {
    if (startsWith(head, TAR_MAGIC_OFFSET, magic)) return "tar";
  }
  return null;
}

/** What each format is called where a person reads it. */
const FORMAT_NAMES: Readonly<Record<ArchiveFormat, string>> = {
  zip: "zip",
  tar: "tar",
  sevenZip: "7z",
  rar: "rar",
};

export function archiveFormatName(format: ArchiveFormat): string {
  return FORMAT_NAMES[format];
}
