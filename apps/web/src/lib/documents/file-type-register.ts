/*
 * The register of how a file opens: every family of format the platform knows, the way the one
 * Open gesture takes it today, and what that way is. ONE HOME. The file manager decides Open from
 * this register (editable-documents.ts reads it), and Settings · Opening Files renders it, so the
 * list a member reads and the decision the product makes are the same object and cannot disagree.
 * Nothing else in the application lists a format.
 *
 * WHY A REGISTER AND NOT A FUNCTION. The owner's direction is that this is a routing table: today
 * every family has one way of opening, and the table states it; later a family may offer more than
 * one (a desktop application, a different editor) and a firm or a member may choose. A table with
 * one column per family grows a second column; a chain of conditionals does not.
 *
 * THE OFFICE FAMILIES ARE THE EDITOR'S OWN LIST. The browser editor is Collabora Online, and the
 * formats it opens are the ones its discovery document advertises for Writer, Calc, Impress and
 * Draw. They are copied here by extension because the editor itself decides which application
 * opens a document from the extension of the name the host reports, so the extension is the fact
 * that matters. Two departures, both stated on the family: plain text is Collabora's to open and is
 * routed to the application's own text editor instead, because a format whose content is its bytes
 * is edited better where the bytes are small and the save is the ordinary upload; and Draw's raster
 * and portable formats are left to the preview and the platform's own PDF reader, which draw them
 * without starting a container.
 *
 * The extension lists for the families the platform reads itself (text, images, archives) are
 * read off the design system's file-type table, which is where those families are defined, rather
 * than copied: `extensionsOfCategory` is the one read.
 */
import { extensionsOfCategory, type FileCategory } from "@magna-carta/design-system/file-icon";

/** A way a file can open. Each is one destination the Open gesture can take a file to. */
export type OpenMethod =
  | "office-editor"
  | "text-editor"
  | "pdf-viewer"
  | "preview"
  | "archive"
  | "download";

export interface OpenMethodPresentation {
  readonly id: OpenMethod;
  /** Title Case, as a settings heading. */
  readonly label: string;
  /** What happens, in one sentence. */
  readonly description: string;
}

/** The ways, in the order a reader meets them: the editors first, then the readers, then the rest. */
export const OPEN_METHODS: readonly OpenMethodPresentation[] = [
  {
    id: "office-editor",
    label: "Browser Editor",
    description:
      "Opens in the built-in office editor. The document stays in the firm's storage, and every save is a new version.",
  },
  {
    id: "text-editor",
    label: "Text Editor",
    description:
      "Opens in the application's own text editor. Saving cuts a new version through the same upload every other save uses.",
  },
  {
    id: "pdf-viewer",
    label: "PDF Reader",
    description: "Opens in the built-in PDF reader. PDFs can't be changed here.",
  },
  {
    id: "preview",
    label: "Preview Panel",
    description:
      "Opens the preview beside the file list. If a format can't be shown, you can download it instead.",
  },
  {
    id: "archive",
    label: "Opens Into Itself",
    description: "Archives open as a folder in the file manager.",
  },
  {
    id: "download",
    label: "Download Only",
    description:
      "Never opened in the browser. The file is downloaded, and what runs it is the member's own machine.",
  },
];

export interface FileTypeFamily {
  readonly id: string;
  /** Title Case, as a row label. */
  readonly label: string;
  readonly method: OpenMethod;
  /** Lowercase, without the dot, sorted. */
  readonly extensions: readonly string[];
  /** Where the family's list comes from, or a departure from it, stated for the reader. */
  readonly note?: string;
}

// Collabora Online's discovery document, Writer application (edit): every extension it opens as a
// word-processing document, less `txt`, which the platform routes to its own text editor.
const WRITER_EXTENSIONS = [
  "602",
  "abw",
  "cwk",
  "doc",
  "docm",
  "docx",
  "dot",
  "dotm",
  "dotx",
  "fb2",
  "fodt",
  "hwp",
  "lrf",
  "mw",
  "odm",
  "odt",
  "otm",
  "ott",
  "pages",
  "pdb",
  "rtf",
  "stw",
  "sxg",
  "sxw",
  "wpd",
  "wps",
  "wri",
] as const;

// Calc application (edit).
const CALC_EXTENSIONS = [
  "123",
  "csv",
  "dbf",
  "dif",
  "fods",
  "gnumeric",
  "numbers",
  "ods",
  "ots",
  "qpw",
  "slk",
  "stc",
  "sxc",
  "tsv",
  "wb1",
  "wk1",
  "wks",
  "wq1",
  "wq2",
  "xla",
  "xlr",
  "xls",
  "xlsb",
  "xlsm",
  "xlsx",
  "xltm",
  "xltx",
] as const;

// Impress application (edit). `pps` is not in the discovery document but is the binary slideshow
// the same application opens as `ppt`; the file-type table already reads it as a presentation.
const IMPRESS_EXTENSIONS = [
  "cgm",
  "fodp",
  "key",
  "odp",
  "otp",
  "pot",
  "potm",
  "potx",
  "pps",
  "ppsx",
  "ppt",
  "pptm",
  "pptx",
  "sti",
  "sxi",
] as const;

// Draw application (edit), less the raster images (bmp gif jpeg jpg png svg tiff) and the portable
// document, which the platform reads itself.
const DRAW_EXTENSIONS = [
  "cdr",
  "dxf",
  "emf",
  "fh",
  "fodg",
  "odg",
  "otg",
  "p65",
  "pub",
  "std",
  "sxd",
  "vsd",
  "vsdx",
  "vss",
  "wmf",
  "wpg",
] as const;

function platformFamily(
  id: string,
  label: string,
  method: OpenMethod,
  categories: readonly FileCategory[],
  note?: string,
): FileTypeFamily {
  const extensions = [
    ...new Set(categories.flatMap((category) => extensionsOfCategory(category))),
  ].toSorted();
  return note === undefined
    ? { id, label, method, extensions }
    : { id, label, method, extensions, note };
}

/** The register. Order is the order Settings · Opening Files lists the families in. */
export const FILE_TYPE_FAMILIES: readonly FileTypeFamily[] = [
  {
    id: "word-processing",
    label: "Word-Processing Documents",
    method: "office-editor",
    extensions: [...WRITER_EXTENSIONS].toSorted(),
    note: "The editor's own list for word-processing documents. Plain text is listed under the text editor instead.",
  },
  {
    id: "spreadsheets",
    label: "Spreadsheets",
    method: "office-editor",
    extensions: [...CALC_EXTENSIONS].toSorted(),
    note: "The editor's own list for spreadsheets, comma- and tab-separated values included.",
  },
  {
    id: "presentations",
    label: "Presentations",
    method: "office-editor",
    extensions: [...IMPRESS_EXTENSIONS].toSorted(),
    note: "The editor's own list for presentations.",
  },
  {
    id: "drawings",
    label: "Drawings and Diagrams",
    method: "office-editor",
    extensions: [...DRAW_EXTENSIONS].toSorted(),
    note: "The editor's drawing formats, except images and PDFs, which Magna Carta shows itself.",
  },
  platformFamily("text-and-code", "Plain Text and Code", "text-editor", ["text", "code"]),
  platformFamily("pdf", "PDF Documents", "pdf-viewer", ["pdf"]),
  platformFamily("images", "Images", "preview", ["image"]),
  platformFamily("audio-and-video", "Audio and Video", "preview", ["audio", "video"]),
  platformFamily("email", "Email Messages", "preview", ["email"]),
  platformFamily("archives", "Archives", "archive", ["archive"]),
  platformFamily(
    "programs",
    "Programs and Installers",
    "download",
    ["program"],
    "Never opened in the browser: a program is not a document.",
  ),
];

const OFFICE_EXTENSIONS: ReadonlySet<string> = new Set(
  FILE_TYPE_FAMILIES.filter((family) => family.method === "office-editor").flatMap(
    (family) => family.extensions,
  ),
);

/** Whether the browser editor opens files of this extension (lowercase, no dot). */
export function officeEditorOpens(extension: string): boolean {
  return OFFICE_EXTENSIONS.has(extension);
}

/**
 * The families that open a given way, in register order. What a settings plate renders.
 */
export function familiesOpenedBy(method: OpenMethod): readonly FileTypeFamily[] {
  return FILE_TYPE_FAMILIES.filter((family) => family.method === method);
}

/** The way a file category opens where the register knows the category, else null. */
export function openMethodOfCategory(category: FileCategory): OpenMethod | null {
  switch (category) {
    case "word":
    case "excel":
    case "powerpoint":
      return "office-editor";
    case "text":
    case "code":
      return "text-editor";
    case "pdf":
      return "pdf-viewer";
    case "image":
    case "video":
    case "audio":
    case "email":
      return "preview";
    case "archive":
      return "archive";
    case "program":
      return "download";
    case "unknown":
      return null;
  }
}
