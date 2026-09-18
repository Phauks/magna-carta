/*
 * A file's identity, as the file manager states it, for every surface that shows a file.
 *
 * THIS IS THE ONE PLACE A FILE IS TURNED INTO WORDS. The design-system FileIcon already resolves a
 * category from the content type and the name; the status register already carries the safety
 * vocabulary; the firm's document types already name what a document IS. What no surface had was
 * one function composing them — so the Activity section's first cut took a name suffix for a file's
 * type, and the file list and the search results each phrase a size their own way. Every surface
 * that names a file — the file list, the Activity section, the matter's search — reads this, so a
 * correction to a word lands once and all of them follow.
 */
import { resolveFileCategory, type FileCategory } from "@magna-carta/design-system/file-icon";
import { statusEntry } from "@magna-carta/design-system/status-register";
import { safetyKeyOf } from "./file-columns.ts";
import type { SafetyKey } from "./file-manager-vocabulary.ts";
import type { MatterFileStatus, ScanVerdict } from "./matter-file-api.ts";

/**
 * What a file of each category is called, in a reader's words. The document type wins where the
 * firm set one; this is the identification's own label where it did not — "PDF document", never
 * "pdf", and never "Document", which is the column repeating its own heading.
 */
const CATEGORY_LABEL: Readonly<Record<FileCategory, string>> = {
  pdf: "PDF document",
  word: "Word document",
  excel: "Spreadsheet",
  powerpoint: "Presentation",
  image: "Image",
  video: "Video",
  audio: "Audio",
  archive: "Archive",
  text: "Text file",
  code: "Code",
  email: "Email message",
  program: "Program",
  unknown: "File",
};

export interface FileIdentityInput {
  readonly fileName: string;
  /** The content type sniffed from the bytes at upload, where a version exists. */
  readonly contentType: string | null;
  /** The firm's classification, where one was set. */
  readonly documentTypeName: string | null;
}

/**
 * The file's type, in words: its document type where the firm set one, else what the name claims —
 * the same reading the icon draws and the File Type column prints, so one row never says three
 * things. Whether the claim holds is the analysis's finding, stated beside the name, not here.
 */
export function fileTypeLabel(input: FileIdentityInput): string {
  if (input.documentTypeName !== null && input.documentTypeName.length > 0) {
    return input.documentTypeName;
  }
  return CATEGORY_LABEL[
    resolveFileCategory({
      contentType: input.contentType ?? undefined,
      fileName: input.fileName,
    })
  ];
}

/** Bytes as a person reads them. Undefined where the record holds no size. */
export function fileSizeText(sizeBytes: number | null): string | undefined {
  if (sizeBytes === null) return undefined;
  if (sizeBytes < 1024) return `${String(sizeBytes)} B`;
  const kilobytes = sizeBytes / 1024;
  if (kilobytes < 1024) return `${kilobytes.toFixed(kilobytes < 10 ? 1 : 0)} KB`;
  const megabytes = kilobytes / 1024;
  return `${megabytes.toFixed(megabytes < 10 ? 1 : 0)} MB`;
}

const FILE_STATUSES: readonly MatterFileStatus[] = ["pending", "clean", "quarantined"];
const SCAN_VERDICTS: readonly ScanVerdict[] = ["unscanned", "clean", "flagged"];

export interface FileSafetyInput {
  readonly status: string | null;
  readonly scanVerdict: string | null;
  readonly hasVersion: boolean;
  readonly documentTypeId: string | null;
}

/**
 * The file's safety standing, graded exactly as the file list grades it, from the facts a describe
 * carries. A status this build does not know is treated as pending — the cautious reading.
 */
export function fileSafetyKey(input: FileSafetyInput): SafetyKey {
  const status = FILE_STATUSES.find((candidate) => candidate === input.status) ?? "pending";
  const scanVerdict = SCAN_VERDICTS.find((candidate) => candidate === input.scanVerdict) ?? null;
  return safetyKeyOf({
    status,
    scanVerdict,
    currentVersionId: input.hasVersion ? "present" : null,
  });
}

/**
 * The safety standing as a word, or undefined where the register says nothing at all — a clean,
 * typed file carries the bare mark in the file list and no word here either.
 */
export function fileSafetyWord(key: SafetyKey): string | undefined {
  if (key === "clean") return undefined;
  return statusEntry(key).label;
}
