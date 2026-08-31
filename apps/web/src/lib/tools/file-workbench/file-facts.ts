/*
 * What the workbench has read about a file, in the form other capabilities ask the question.
 *
 * Almost every capability's "does this apply" answer turns on what the file actually is, so the
 * reading is derived in one place rather than each module reaching into the outcome bag and
 * comparing label strings its own way. A new capability asks `isImage(file)` and gets the same
 * answer as every other capability, including after the identification moves from the browser
 * prefix scan to the content service.
 */
import type { ProvisionalFileType } from "./identify.ts";
import { FILE_TYPE_CAPABILITY, outcomeFor, type WorkbenchFile } from "./workbench-file.ts";

/** The identification, or null while it has not answered. */
export function fileTypeOf(file: WorkbenchFile): ProvisionalFileType | null {
  const outcome = outcomeFor<ProvisionalFileType>(file, FILE_TYPE_CAPABILITY);
  return outcome.kind === "result" ? outcome.value : null;
}

/** The label the bytes read as (`pdf`, `docx`, `pe`), or null while unidentified. */
export function detectedLabelOf(file: WorkbenchFile): string | null {
  return fileTypeOf(file)?.report.detected ?? null;
}

/** The broad family (`document`, `image`, `archive`, `executable`, `text`), or null. */
export function groupOf(file: WorkbenchFile): string | null {
  return fileTypeOf(file)?.report.group ?? null;
}

/** Whether the name and the bytes disagree about what this file is. */
export function hasExtensionMismatch(file: WorkbenchFile): boolean {
  return fileTypeOf(file)?.report.extensionMatch === "mismatch";
}

const LABELS = {
  image: new Set(["png", "jpeg", "gif", "tiff", "bmp", "webp", "heif"]),
  /** Formats that carry a text layer of their own, so recognition has nothing to add. */
  textBearing: new Set(["txt", "csv", "json", "xml", "html", "markdown", "rtf", "email"]),
  officeDocument: new Set(["docx", "xlsx", "pptx", "doc", "xls", "ppt"]),
  archive: new Set(["zip", "sevenzip", "rar", "gzip", "tar"]),
} as const;

export const isImage = (file: WorkbenchFile): boolean =>
  LABELS.image.has(detectedLabelOf(file) ?? "");

export const isEmail = (file: WorkbenchFile): boolean => detectedLabelOf(file) === "email";

export const isPdf = (file: WorkbenchFile): boolean => detectedLabelOf(file) === "pdf";

export const isArchive = (file: WorkbenchFile): boolean =>
  LABELS.archive.has(detectedLabelOf(file) ?? "");

export const isOfficeDocument = (file: WorkbenchFile): boolean =>
  LABELS.officeDocument.has(detectedLabelOf(file) ?? "");

/** Whether the file already carries selectable text, which is what Text Recognition is for. */
export const carriesText = (file: WorkbenchFile): boolean =>
  LABELS.textBearing.has(detectedLabelOf(file) ?? "") || isOfficeDocument(file);

/** Formats a password can lock. Which of them IS locked is the unlock capability's own question. */
export const canBePasswordProtected = (file: WorkbenchFile): boolean =>
  isPdf(file) || isOfficeDocument(file) || isArchive(file);

/** How this file reads to a person, e.g. "PDF document". Falls back to the name's extension. */
export function describeType(file: WorkbenchFile): string {
  const identified = fileTypeOf(file);
  if (identified) return identified.report.detectedLabel;
  const dot = file.name.lastIndexOf(".");
  return dot > 0 ? `${file.name.slice(dot + 1).toUpperCase()} file` : "Unidentified";
}
