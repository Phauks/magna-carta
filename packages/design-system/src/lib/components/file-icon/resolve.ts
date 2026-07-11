/*
 * FileIcon resolution — the pure mapping from a file's identity (content type and/or name) to the
 * Lucide glyph that represents it. Kept as a plain, side-effect-free module (no Svelte) so the
 * mapping has ONE home and is unit-testable on its own: the component is a thin renderer over
 * resolveFileIcon().
 *
 * Two inputs, in priority order: the MIME `contentType` (authoritative when present — a server-set
 * type beats a user-chosen extension), then the file name's extension. A `category` override
 * short-circuits both (for a caller that already knows the kind), and `folder` renders the folder
 * row glyph a file list draws above its file rows.
 *
 * Icon choices are deliberately calm and uniform in weight (the file list is a work surface — the
 * type glyph informs, it does not shout). Lucide has no dedicated PDF glyph, so pdf and plain text
 * share the generic text-document mark (`file-text`); both are text documents, so this reads
 * correctly rather than as a gap.
 */
import File from "@lucide/svelte/icons/file";
import FileText from "@lucide/svelte/icons/file-text";
import FileType from "@lucide/svelte/icons/file-type";
import FileSpreadsheet from "@lucide/svelte/icons/file-spreadsheet";
import Presentation from "@lucide/svelte/icons/presentation";
import FileImage from "@lucide/svelte/icons/file-image";
import FileVideo from "@lucide/svelte/icons/file-video";
import FileAudio from "@lucide/svelte/icons/file-audio";
import FileArchive from "@lucide/svelte/icons/file-archive";
import FileCode from "@lucide/svelte/icons/file-code";
import Mail from "@lucide/svelte/icons/mail";
import Folder from "@lucide/svelte/icons/folder";
import FolderOpen from "@lucide/svelte/icons/folder-open";

/** A Lucide icon component, as imported from `@lucide/svelte/icons/*`. */
export type FileIconComponent = typeof File;

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
  | "unknown";

/** One glyph per category — the single source of truth for what each kind looks like. */
const CATEGORY_ICON: Record<FileCategory, FileIconComponent> = {
  pdf: FileText,
  word: FileType,
  excel: FileSpreadsheet,
  powerpoint: Presentation,
  image: FileImage,
  video: FileVideo,
  audio: FileAudio,
  archive: FileArchive,
  text: FileText,
  code: FileCode,
  email: Mail,
  unknown: File,
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
};

/** The category for a MIME type, or undefined if it is empty or unrecognized. */
function categoryFromContentType(contentType: string): FileCategory | undefined {
  // Drop any parameters (`; charset=…`) and normalize case before matching.
  const type = contentType.trim().toLowerCase().split(";", 1)[0]!.trim();
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
function extensionOf(fileName: string): string {
  const trimmed = fileName.trim().toLowerCase();
  const dot = trimmed.lastIndexOf(".");
  // A leading dot (dotfile) or trailing dot is not an extension.
  if (dot <= 0 || dot === trimmed.length - 1) return "";
  return trimmed.slice(dot + 1);
}

/**
 * Resolve the file kind from its content type (preferred) and/or name. Returns `unknown` when
 * neither resolves — never throws, so a partial or missing descriptor is always safe.
 */
export function resolveFileCategory(input: {
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
 * Resolve the Lucide glyph for a file or folder. `folder` wins first (a folder row draws a folder,
 * open or closed); then an explicit `category` override; then the derived category.
 */
export function resolveFileIcon(input: {
  contentType?: string;
  fileName?: string;
  category?: FileCategory;
  folder?: boolean;
  open?: boolean;
}): FileIconComponent {
  if (input.folder) return input.open ? FolderOpen : Folder;
  const category = input.category ?? resolveFileCategory(input);
  return CATEGORY_ICON[category];
}
