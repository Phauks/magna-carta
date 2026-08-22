// Stable machine-readable refusal codes for the File Manager — callers branch on the code, never the
// message. One error type for the whole module (the ledger pattern).
export type FileManagerValidationCode =
  // A folder or file name that is empty or only whitespace. Shared by folders and files: the rule is
  // the same one the database CHECK enforces, applied here so a bad name is a named refusal the route
  // can map, not a raw constraint failure surfacing as a server error.
  | "invalid-name"
  // Folders
  | "unknown-folder"
  | "folder-name-taken"
  | "folder-not-empty"
  | "folder-cycle"
  // Files & versions
  | "unknown-file"
  // A write aimed at a file that is soft-deleted. Distinct from "unknown-file" so the refusal is
  // legible in logs and tests, but the routes deliberately surface both as the same not-found
  // response: a deleted file is invisible to every consumer read, so a mutation must not be the one
  // path that confirms it still exists.
  | "file-deleted"
  | "unknown-version"
  | "version-not-pending"
  // Offline checkout / check-in
  | "unknown-checkout"
  // Same-matter integrity: a file, folder, or move must not cross matter boundaries
  | "folder-cross-matter"
  | "file-cross-matter"
  | "file-matter-mismatch"
  // Upload policy (re-checked against real bytes at the ingest gate too)
  | "upload-policy-size"
  | "upload-policy-type"
  // A continuation cursor presented against a different order from the one that minted it. Refused
  // rather than restarted: the token is well-formed and was issued by this system, so the caller is
  // mid-scroll, and silently handing them the first page while their interface believes it is on page
  // four is worse than telling them the cursor no longer applies.
  | "cursor-sort-mismatch"
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
