/*
 * The file-type vocabulary — which kind a file is, how that kind is coloured, and the real-text
 * badge that names its exact format. Pure data and pure functions: no Svelte, no icon components,
 * nothing that has to be rendered to be checked, so the mapping has ONE home and is unit-testable
 * on its own. resolve.ts is the layer above, which turns a kind into a Lucide glyph.
 *
 * Two inputs, in priority order: the file name's extension, then the MIME `contentType`. The icon
 * states what the file CLAIMS to be — the name is the claim, and it is what the File Type column
 * beside the icon shows, so the two can never disagree in one row. Whether the claim holds is a
 * separate fact, owned by the file manager's analysis (apps/web/src/lib/file-manager/file-analysis.ts):
 * the host sniffs the bytes at intake, and a name that says one thing over bytes that read as another
 * is reported there as a type mismatch, beside the name, in the safety vocabulary. So a name with
 * an extension nobody recognizes draws the blank sheet and no badge, whatever the bytes are — the
 * icon does not quietly correct the name, it lets the verifier say the name is wrong. The content
 * type decides only where the name makes no claim at all: no extension, or no name.
 *
 * TYPE IDENTITY. We author no glyphs of our own; every mark on this component comes from the
 * installed Lucide package, and Lucide has no per-format glyph. The identity a file type needs
 * beyond its glyph is therefore carried by a badge of REAL TEXT — the file's own extension,
 * upper-cased, in the type's colour — so a pdf is not "a generic document" and a .doc is not
 * mistaken for a .docx. Deliberately narrow: only the document formats a reader genuinely confuses
 * are badged. An image, a video, an audio file and an archive each already have a glyph that says
 * what they are, so a badge on them would be noise on a work surface.
 */

/**
 * The recognized file kinds. `unknown` is the honest fallback (a blank document) when neither the
 * content type nor the extension resolves.
 */
export type FileCategory =
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "image"
  | "video"
  | "audio"
  | "archive"
  | "text"
  | "code"
  | "email"
  | "program"
  | "unknown";

/**
 * How a file type is coloured. `default` is the calm muted glyph a work surface wants; the three
 * hues are the same pale-tint register the status pills use (a tint behind deep same-hue text),
 * never the saturated solid pair — a table of files must not read as a table of alarms.
 */
export type FileIconTone = "default" | "danger" | "info" | "success";

/** The real-text badge that rides the glyph: the file's own extension, upper-cased, and its tone. */
export interface FileTypeBadge {
  readonly text: string;
  readonly tone: FileIconTone;
}

/**
 * The glyph's own colour. Only an executable departs from the calm default: a program is the one
 * file kind whose type is a caution in itself, so it is the one glyph that carries a hue.
 */
const CATEGORY_TONE: Partial<Record<FileCategory, FileIconTone>> = {
  program: "danger",
};

/**
 * The badge's colour, per category — and the list of badged categories: a category absent here is
 * never badged. Red for the portable document, blue for the word processor, green for the
 * spreadsheet: conventions a reader already holds, so the badge is read before it is parsed.
 */
const BADGE_TONE: Partial<Record<FileCategory, FileIconTone>> = {
  pdf: "danger",
  word: "info",
  excel: "success",
};

/**
 * The badge text a category falls back to when neither the file name nor the content type can
 * answer. Only pdf has one: a pdf's glyph is the empty sheet, so without the badge it is
 * indistinguishable from an unrecognized file. Word and spreadsheet have no single honest default
 * — doc and docx are different internals, and telling them apart is the badge's whole job — so an
 * unnamed one goes unbadged rather than guessing.
 */
const CATEGORY_BADGE_TEXT: Partial<Record<FileCategory, string>> = {
  pdf: "PDF",
};

/** Exact MIME types that map to a category. Prefix families (image/*, …) are handled separately. */
const CONTENT_TYPE_CATEGORY: Record<string, FileCategory> = {
  "application/pdf": "pdf",
  "application/msword": "word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word",
  "application/vnd.oasis.opendocument.text": "word",
  "application/rtf": "word",
  "application/vnd.ms-excel": "excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "excel",
  "application/vnd.oasis.opendocument.spreadsheet": "excel",
  "text/csv": "excel",
  "application/vnd.ms-powerpoint": "powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "powerpoint",
  "application/vnd.oasis.opendocument.presentation": "powerpoint",
  "application/zip": "archive",
  "application/x-7z-compressed": "archive",
  "application/x-rar-compressed": "archive",
  "application/vnd.rar": "archive",
  "application/x-tar": "archive",
  "application/gzip": "archive",
  "application/x-bzip2": "archive",
  "message/rfc822": "email",
  "application/vnd.ms-outlook": "email",
  "application/vnd.microsoft.portable-executable": "program",
  "application/x-msdownload": "program",
  "application/x-msi": "program",
  "application/x-apple-diskimage": "program",
  "application/vnd.android.package-archive": "program",
  "application/vnd.debian.binary-package": "program",
  "application/x-rpm": "program",
  "application/x-executable": "program",
  "application/java-archive": "program",
  "text/html": "code",
  "text/css": "code",
  "text/javascript": "code",
  "application/json": "code",
  "application/xml": "code",
  "text/xml": "code",
  "application/x-yaml": "code",
  "text/markdown": "text",
  "text/plain": "text",
};

/** File-name extensions (lowercase, no dot) that map to a category. */
const EXTENSION_CATEGORY: Record<string, FileCategory> = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  dot: "word",
  dotx: "word",
  xls: "excel",
  xlsx: "excel",
  xlsm: "excel",
  ods: "excel",
  csv: "excel",
  ppt: "powerpoint",
  pptx: "powerpoint",
  pps: "powerpoint",
  ppsx: "powerpoint",
  odp: "powerpoint",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  heic: "image",
  heif: "image",
  avif: "image",
  ico: "image",
  mp4: "video",
  mov: "video",
  avi: "video",
  mkv: "video",
  webm: "video",
  wmv: "video",
  flv: "video",
  m4v: "video",
  mpeg: "video",
  mpg: "video",
  mp3: "audio",
  wav: "audio",
  flac: "audio",
  aac: "audio",
  ogg: "audio",
  m4a: "audio",
  wma: "audio",
  opus: "audio",
  zip: "archive",
  "7z": "archive",
  rar: "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",
  xz: "archive",
  txt: "text",
  md: "text",
  markdown: "text",
  log: "text",
  html: "code",
  htm: "code",
  css: "code",
  js: "code",
  ts: "code",
  jsx: "code",
  tsx: "code",
  json: "code",
  xml: "code",
  yml: "code",
  yaml: "code",
  sh: "code",
  py: "code",
  rs: "code",
  eml: "email",
  msg: "email",
  exe: "program",
  msi: "program",
  msix: "program",
  dmg: "program",
  pkg: "program",
  apk: "program",
  deb: "program",
  rpm: "program",
  appimage: "program",
  jar: "program",
  bat: "program",
  cmd: "program",
  ps1: "program",
  vbs: "program",
  scr: "program",
};

/**
 * The badge text for a content type that has no file name to read. Kept separate from the category
 * map because a category covers several formats and the badge names exactly one of them.
 */
const CONTENT_TYPE_BADGE_TEXT: Record<string, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.oasis.opendocument.text": "ODT",
  "application/rtf": "RTF",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.oasis.opendocument.spreadsheet": "ODS",
  "text/csv": "CSV",
};

/** Drop any parameters (`; charset=…`) and normalize case, so a MIME type matches on its own. */
function normalizeContentType(contentType: string): string {
  return contentType.trim().toLowerCase().split(";", 1)[0]!.trim();
}

/** The category for a MIME type, or undefined if it is empty or unrecognized. */
function categoryFromContentType(contentType: string): FileCategory | undefined {
  const type = normalizeContentType(contentType);
  if (type === "") return undefined;
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  const exact = CONTENT_TYPE_CATEGORY[type];
  if (exact) return exact;
  // Any other text/* is plain text (the specific text/* codes are handled above).
  if (type.startsWith("text/")) return "text";
  return undefined;
}

/** The lowercase extension of a file name (no dot), or "" when there is none. */
export function extensionOf(fileName: string): string {
  const trimmed = fileName.trim().toLowerCase();
  const dot = trimmed.lastIndexOf(".");
  // A leading dot (dotfile) or trailing dot is not an extension.
  if (dot <= 0 || dot === trimmed.length - 1) return "";
  return trimmed.slice(dot + 1);
}

/**
 * Every file-name extension this table knows a category by, sorted. The one place the platform's
 * own extension list can be read from, so a screen that lists what a category covers (Settings ·
 * Opening Files) renders the same list this resolver decides by, and neither can drift.
 */
export function extensionsOfCategory(category: FileCategory): readonly string[] {
  return Object.entries(EXTENSION_CATEGORY)
    .filter(([, known]) => known === category)
    .map(([extension]) => extension)
    .toSorted();
}

/**
 * Resolve the file kind from its name (preferred) and/or content type. A name with an extension
 * decides on its own — a recognized extension names the kind, an unrecognized one is `unknown` —
 * because the icon draws the claim and never reads past it to the bytes. The content type answers
 * only when the name makes no claim: no extension, or no name at all. Returns `unknown` when
 * nothing resolves — never throws, so a partial or missing descriptor is always safe.
 */
export function resolveFileCategory(input: {
  contentType?: string;
  fileName?: string;
}): FileCategory {
  if (input.fileName) {
    const extension = extensionOf(input.fileName);
    if (extension !== "") return EXTENSION_CATEGORY[extension] ?? "unknown";
  }
  if (input.contentType) {
    const byContentType = categoryFromContentType(input.contentType);
    if (byContentType) return byContentType;
  }
  return "unknown";
}

/**
 * Resolve the file kind from what the bytes say (preferred) and/or the name — the opposite
 * precedence from resolveFileCategory, for the opposite job. That one decides what to DRAW, and
 * draws the claim; this one decides what to DO with a file — which editor opens it, which reader
 * draws its pages — and a decision about handling bytes has to read the bytes. A Word document
 * renamed to end in ".txt" is drawn as the text file its name claims, and opened as the Word
 * document it is, never handed to the plain-text editor on the strength of its name. The name
 * answers only where nothing was sniffed, which is where plain text always lands: text has no
 * signature, so a text or code file is known by its extension alone.
 */
export function resolveFileContentCategory(input: {
  contentType?: string;
  fileName?: string;
}): FileCategory {
  if (input.contentType) {
    const byContentType = categoryFromContentType(input.contentType);
    if (byContentType) return byContentType;
  }
  if (input.fileName) {
    const byExtension = EXTENSION_CATEGORY[extensionOf(input.fileName)];
    if (byExtension) return byExtension;
  }
  return "unknown";
}

/**
 * The kind a name claims by its extension alone, or undefined where the name claims nothing (no
 * extension). Distinct from resolveFileCategory: an unrecognized extension is a claim that reads as
 * `unknown`, and no extension is no claim, and a caller comparing the claim against the bytes needs
 * to tell those apart.
 */
export function claimedFileCategory(fileName: string): FileCategory | undefined {
  const extension = extensionOf(fileName);
  if (extension === "") return undefined;
  return EXTENSION_CATEGORY[extension] ?? "unknown";
}

/**
 * The kind the bytes read as, from the content type the host sniffed at intake, or undefined where
 * the sniff recognized nothing or the type is not one the vocabulary knows. Undefined here means
 * "no reading", never "unknown kind" — a comparison against the claim has nothing to compare.
 */
export function sniffedFileCategory(contentType: string): FileCategory | undefined {
  return categoryFromContentType(contentType);
}

/** The tone a category's glyph is drawn in. */
export function resolveFileIconTone(category: FileCategory): FileIconTone {
  return CATEGORY_TONE[category] ?? "default";
}

/**
 * The badge for a file, or undefined when its category is not one that carries one.
 *
 * The file's own extension is preferred, because that is what the File Type column shows and the
 * two must agree; it is used only when it names the SAME kind the glyph is drawing, so a caller
 * that overrides the category never gets a DOCX badge over a pdf glyph. Failing that, the content
 * type names the format, and failing that the category's own default (pdf only).
 */
export function resolveFileTypeBadge(input: {
  contentType?: string;
  fileName?: string;
  category?: FileCategory;
}): FileTypeBadge | undefined {
  const category = input.category ?? resolveFileCategory(input);
  const tone = BADGE_TONE[category];
  if (tone === undefined) return undefined;

  if (input.fileName) {
    const extension = extensionOf(input.fileName);
    if (extension !== "" && EXTENSION_CATEGORY[extension] === category) {
      return { text: extension.toUpperCase(), tone };
    }
  }
  if (input.contentType) {
    const text = CONTENT_TYPE_BADGE_TEXT[normalizeContentType(input.contentType)];
    if (text !== undefined) return { text, tone };
  }
  const fallback = CATEGORY_BADGE_TEXT[category];
  return fallback === undefined ? undefined : { text: fallback, tone };
}
