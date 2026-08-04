// Does the type sniffed from an upload's magic bytes AGREE with the type the client declared?
//
// The ingest gate treats a declared type contradicted by the real bytes as a lie and quarantines the
// version. Byte-exact string equality is the wrong test for that question, because a magic-byte
// sniffer reads the CONTAINER, not the document inside it. Two whole families of everyday legal-work
// files are container formats whose members share one signature:
//
//   - The pre-2007 Microsoft Office family (.doc/.xls/.ppt/.msg and friends) is Compound File Binary
//     Format. Every member starts with the same eight OLE2 bytes, so the sniffer can only ever say
//     `application/x-cfb` — never `application/msword`, which is what a browser declares from the
//     .doc extension. Strict equality quarantines every legacy Word document a firm uploads.
//   - The OOXML/OpenDocument family is a ZIP. The sniffer usually reads far enough into the archive to
//     name the specific member (`...wordprocessingml.document`), but when the marker entries fall
//     outside the head window it can only say `application/zip`. The same file can therefore sniff two
//     different ways depending on how its producer ordered the archive.
//
// So the comparison is: normalize both sides, accept equality, and otherwise accept only a pairing
// this file names explicitly — a container signature against a member of that container's family.
// Everything else still disagrees and still quarantines: the table is an allow-list of known
// container relationships, not a general loosening, and an unknown pair fails closed.
//
// What this does NOT weaken: the recorded `sniffed_content_type` is always the SNIFFED value, and the
// upload-policy re-check (upload-policy.ts) runs against that sniffed type plus the real file name.
// A client cannot smuggle a policy-blocked type or extension past the gate by declaring a friendlier
// one — agreeing here only means "the declaration is not a lie", never "this type is allowed".

// MIME types are case-insensitive and may carry parameters (`; charset=`, `; version=`). The sniffer
// lower-cases what it reads out of an OOXML content-types part, while browsers send the registered
// spelling — `application/vnd.ms-word.document.macroEnabled.12` with its capital E — so a raw
// comparison would reject a macro-enabled Word document on letter case alone.
export function normalizeContentType(value: string | null): string | null {
  if (value === null) return null;
  const withoutParameters = value.split(";")[0] ?? "";
  const normalized = withoutParameters.trim().toLowerCase();
  return normalized === "" ? null : normalized;
}

// The Compound File Binary Format signature the sniffer reports for the whole pre-2007 Office family.
const COMPOUND_FILE_BINARY_CONTENT_TYPE = "application/x-cfb";

// Declared types whose bytes ARE a compound file — every one of these sniffs as x-cfb and nothing
// finer, because the format carries no discriminating magic beyond the OLE2 header.
const COMPOUND_FILE_MEMBER_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "application/msword", // .doc, .dot
  "application/vnd.ms-word", // a client alias for the same thing
  "application/vnd.ms-excel", // .xls, .xlt, .xla
  "application/vnd.ms-powerpoint", // .ppt, .pot, .pps, .ppa
  "application/vnd.ms-outlook", // .msg — the format opposing counsel emails arrive in
  "application/vnd.ms-project", // .mpp
  "application/vnd.ms-works", // .wps
  "application/vnd.visio", // .vsd (the pre-2013 binary Visio drawing)
  "application/vnd.ms-office", // the generic "some Office binary" a few clients send
  "application/x-ole-storage", // the generic compound-file name others send
]);

// The generic ZIP signature, reported whenever the sniffer cannot read far enough into the archive to
// name the document format inside it.
const ZIP_CONTENT_TYPE = "application/zip";

// Declared (and sniffable) types whose bytes ARE a ZIP archive. A file in this set can legitimately
// sniff either as its specific type or as the bare container, so the two are interchangeable in BOTH
// directions: a client declaring `application/zip` for a .docx is as honest as a client declaring the
// full OOXML type for an archive the sniffer only reached the first entry of.
const ZIP_MEMBER_CONTENT_TYPES: ReadonlySet<string> = new Set([
  // OOXML — the modern Office formats.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.template",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  // The macro-enabled OOXML variants (still ZIPs; the macro payload is what the scan port judges).
  "application/vnd.ms-word.document.macroenabled.12",
  "application/vnd.ms-word.template.macroenabled.12",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel.template.macroenabled.12",
  "application/vnd.ms-excel.addin.macroenabled.12",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12",
  "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
  "application/vnd.ms-powerpoint.template.macroenabled.12",
  "application/vnd.ms-powerpoint.addin.macroenabled.12",
  // OpenDocument — what a firm running LibreOffice produces.
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.text-template",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.spreadsheet-template",
  "application/vnd.oasis.opendocument.presentation",
  "application/vnd.oasis.opendocument.presentation-template",
  "application/vnd.oasis.opendocument.graphics",
  "application/vnd.oasis.opendocument.graphics-template",
  // Other ZIP-container document formats that reach a matter.
  "application/epub+zip",
  "application/vnd.visio", // .vsdx — the OOXML-era Visio drawing
]);

// True when the sniffed type and the declared type describe the same bytes: equal after
// normalization, or a container signature paired with a member of that container's family. Either
// side being null means there is nothing to contradict (no signature recognized, or nothing
// declared) — the caller decides what to do with an absent value; this predicate answers only the
// comparison. An unrecognized pair is a disagreement: unknown pairs fail closed.
export function contentTypesAgree(sniffed: string | null, declared: string | null): boolean {
  const sniffedType = normalizeContentType(sniffed);
  const declaredType = normalizeContentType(declared);
  if (sniffedType === null || declaredType === null) return true;
  if (sniffedType === declaredType) return true;
  if (
    sniffedType === COMPOUND_FILE_BINARY_CONTENT_TYPE &&
    COMPOUND_FILE_MEMBER_CONTENT_TYPES.has(declaredType)
  ) {
    return true;
  }
  // The ZIP container relationship holds both ways round: the sniffer may report the bare container
  // for a declared document, or the specific document for a declaration of the bare container.
  if (sniffedType === ZIP_CONTENT_TYPE && ZIP_MEMBER_CONTENT_TYPES.has(declaredType)) return true;
  if (declaredType === ZIP_CONTENT_TYPE && ZIP_MEMBER_CONTENT_TYPES.has(sniffedType)) return true;
  return false;
}
