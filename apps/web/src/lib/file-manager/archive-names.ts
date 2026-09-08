// Whether a file's NAME suggests an archive worth offering "Browse Inside" on.
//
// A name is a claim, and the server does not believe it: the browse route reads the object's own
// first bytes and decides the format from the signature it finds, so a zip named `.dat` opens and a
// text file named `.zip` is refused as what it is. Nothing here is a security or correctness
// boundary — it decides only which menu item a person is offered before anything has been read,
// which is the one decision that has to be made without the bytes in hand.
//
// The formats are the four the browse route lists (zip, tar, 7z, rar), and each is listed from
// header bytes alone: browsing one never fetches, inflates or unpacks it.

/** Extensions, lowercase and without the dot, that name an archive the browse route can list. */
const BROWSABLE_ARCHIVE_EXTENSIONS: ReadonlySet<string> = new Set([
  "zip",
  "tar",
  "7z",
  "rar",
  // A word-processing package and an OpenDocument file are zips, and browsing into one is a real
  // thing to want — but "Browse Inside" on a document a person thinks of as a document is a menu
  // that reads as broken, so they are deliberately not here.
]);

/** Whether "Browse Inside" is worth offering for a file with this name. */
export function nameLooksLikeBrowsableArchive(name: string): boolean {
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1 || lastDot === name.length - 1) return false;
  return BROWSABLE_ARCHIVE_EXTENSIONS.has(name.slice(lastDot + 1).toLowerCase());
}

/**
 * The content types the ingest sniff records for those same four formats. A row that carries one is
 * an archive on better evidence than its name, which is why both are consulted.
 */
const BROWSABLE_ARCHIVE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "application/zip",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
]);

/** Whether this row's own facts say it is an archive worth opening into. */
export function looksLikeBrowsableArchive(
  name: string,
  sniffedContentType: string | null,
): boolean {
  const sniffed = (sniffedContentType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
  return BROWSABLE_ARCHIVE_CONTENT_TYPES.has(sniffed) || nameLooksLikeBrowsableArchive(name);
}

/**
 * Extensions whose members this application can take OUT, which is a smaller set than the ones it
 * can look inside.
 *
 * Listing an archive reads its headers and needs no decoder. Extracting a member needs one for that
 * format's own packing, and there is no memory-safe rar decoder to build against — so a rar browses
 * and does not unpack. The server settles this from the object's bytes; this decides only whether
 * the control is offered, and the control says why when it is not.
 */
const EXTRACTABLE_ARCHIVE_EXTENSIONS: ReadonlySet<string> = new Set(["zip", "tar", "7z"]);

/** Whether members can be taken out of an archive with this name. */
export function nameSuggestsExtractableArchive(name: string): boolean {
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1 || lastDot === name.length - 1) return false;
  return EXTRACTABLE_ARCHIVE_EXTENSIONS.has(name.slice(lastDot + 1).toLowerCase());
}
