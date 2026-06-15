// Stable machine-readable refusal codes for the File Manager — callers branch on the code, never the
// message. One error type for the whole module (the ledger pattern).
export type FileManagerValidationCode =
  // Folders
  | "unknown-folder"
  | "folder-name-taken"
  | "folder-not-empty"
  | "folder-cycle"
  // Files & versions
  | "unknown-file"
  | "unknown-version"
  | "version-not-pending"
  // Same-matter integrity: a file, folder, or move must not cross matter boundaries
  | "folder-cross-matter"
  | "file-cross-matter"
  | "file-matter-mismatch"
  // Upload policy (re-checked against real bytes at the ingest gate too)
  | "upload-policy-size"
  | "upload-policy-type"
  // Upload sessions
  | "unknown-upload-session"
  | "upload-session-not-open"
  // Document types
  | "empty-document-type-name"
  | "document-type-name-taken"
  | "document-type-code-taken"
  | "unknown-document-type";

export class FileManagerValidationError extends Error {
  constructor(
    readonly code: FileManagerValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "FileManagerValidationError";
  }
}
