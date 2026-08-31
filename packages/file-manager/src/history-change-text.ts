import type { FolderId } from "@magna-carta/identifiers/types";
import type { FolderNode } from "./queries.ts";

// Turns a file-history event's recorded (redacted) metadata into the human-readable from/to pair the
// History view renders — "moved from Pleadings / Drafts to Home", "restored to Correspondence".
// Pure over the caller-supplied lookups so the per-event rules are testable without a database; the
// route gathers the referenced ids off the page and resolves them in two bounded reads.
//
// The rules are honest-blank by construction: metadata written before an event kind recorded its
// facts yields nulls, never a guess — and a rename yields nulls ALWAYS, because a file name is free
// text a person routinely writes another person's name into, so the redaction standard
// (audit-statements.ts, and this package's audit.ts) keeps names out of audit metadata entirely.
// The names shown elsewhere in the history are resolved from the LIVE file row at read time.

export interface HistoryChangeTexts {
  readonly fromText: string | null;
  readonly toText: string | null;
}

export interface HistoryChangeLookups {
  // The folder id (null = the matter root) to display text. The route builds it from the matter's
  // current folder tree, so a folder id that no longer resolves gets its honest fallback here.
  folderText(folderId: FolderId | null): string;
  // A document type id to its current name; null when the type row is gone.
  documentTypeName(documentTypeId: string): string | null;
}

export const MATTER_ROOT_TEXT = "Home";
export const GONE_FOLDER_TEXT = "a folder no longer on the matter";

// The display path of each folder on the matter, ancestors first, joined with " / " — plus the two
// fixed answers: "Home" for the root and the gone-folder fallback for an id the tree no longer
// holds. Shares the walk shape zip-composition's archive paths use (visited-guarded, a broken parent
// link keeps the partial path).
export function folderTextResolver(
  folders: readonly FolderNode[],
): (folderId: FolderId | null) => string {
  const byId = new Map<FolderId, FolderNode>(folders.map((folder) => [folder.id, folder]));
  return (folderId) => {
    if (folderId === null) return MATTER_ROOT_TEXT;
    if (!byId.has(folderId)) return GONE_FOLDER_TEXT;
    const segments: string[] = [];
    const visited = new Set<FolderId>();
    let cursor: FolderId | null = folderId;
    while (cursor !== null && !visited.has(cursor)) {
      visited.add(cursor);
      const node = byId.get(cursor);
      if (node === undefined) break;
      segments.push(node.name);
      cursor = node.parentFolderId;
    }
    return segments.toReversed().join(" / ");
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A metadata field that names a folder: a string id, or an explicit null meaning the matter root.
// Returns undefined when the key is absent (or holds something else) — the pre-metadata rows.
function folderIdField(
  metadata: Record<string, unknown>,
  key: string,
): FolderId | null | undefined {
  if (!(key in metadata)) return undefined;
  const value = metadata[key];
  if (value === null) return null;
  return typeof value === "string" ? (value as FolderId) : undefined;
}

// The distinct document-type ids a page of history entries references — what the route resolves to
// names in one bounded read (listDocumentTypeNamesByIds) before rendering the page.
export function collectReferencedDocumentTypeIds(
  inputs: readonly HistoryChangeInput[],
): readonly string[] {
  const ids = new Set<string>();
  for (const input of inputs) {
    if (input.event !== "file.document_type_assigned") continue;
    if (!isRecord(input.metadata)) continue;
    const documentTypeId = input.metadata["documentTypeId"];
    if (typeof documentTypeId === "string") ids.add(documentTypeId);
  }
  return [...ids];
}

// Whether any entry on the page needs the folder tree to render — the gate on the route's one
// folder read, so a page of pure version events costs no extra query.
export function anyEntryReferencesAFolder(inputs: readonly HistoryChangeInput[]): boolean {
  return inputs.some(
    (input) =>
      (input.event === "file.moved" ||
        input.event === "file.deleted" ||
        input.event === "file.restored") &&
      isRecord(input.metadata),
  );
}

export interface HistoryChangeInput {
  readonly event: string;
  readonly versionNumber: number | null;
  // The audit row's parsed metadata (null when the row carried none).
  readonly metadata: unknown;
}

export function resolveHistoryChangeTexts(
  input: HistoryChangeInput,
  lookups: HistoryChangeLookups,
): HistoryChangeTexts {
  const none: HistoryChangeTexts = { fromText: null, toText: null };
  const metadata = isRecord(input.metadata) ? input.metadata : undefined;

  switch (input.event) {
    case "file.moved": {
      if (metadata === undefined) return none;
      const fromFolderId = folderIdField(metadata, "fromFolderId");
      const toFolderId = folderIdField(metadata, "toFolderId");
      return {
        fromText: fromFolderId === undefined ? null : lookups.folderText(fromFolderId),
        toText: toFolderId === undefined ? null : lookups.folderText(toFolderId),
      };
    }
    case "file.deleted": {
      if (metadata === undefined) return none;
      const fromFolderId = folderIdField(metadata, "fromFolderId");
      return {
        fromText: fromFolderId === undefined ? null : lookups.folderText(fromFolderId),
        toText: null,
      };
    }
    case "file.restored": {
      if (metadata === undefined) return none;
      // The current key, falling back to the key the restore recorded before it was normalized —
      // rows already written under the old name keep answering. Keyed on presence, not value,
      // because an explicit null is the matter root and must not fall through.
      const toFolderId =
        "toFolderId" in metadata
          ? folderIdField(metadata, "toFolderId")
          : folderIdField(metadata, "restoredToFolderId");
      return {
        fromText: null,
        toText: toFolderId === undefined ? null : lookups.folderText(toFolderId),
      };
    }
    case "file.document_type_assigned": {
      if (metadata === undefined || !("documentTypeId" in metadata)) return none;
      const documentTypeId = metadata["documentTypeId"];
      // An explicit null recorded the type being CLEARED — an honest null, not a missing fact.
      if (documentTypeId === null || typeof documentTypeId !== "string") return none;
      return { fromText: null, toText: lookups.documentTypeName(documentTypeId) };
    }
    case "file.renamed": {
      // Names never ride audit metadata (redact-by-default), so a rename's from/to cannot be
      // resolved from the trail; should a future row ever carry them, they pass through.
      if (metadata === undefined) return none;
      const fromName = metadata["fromName"];
      const toName = metadata["toName"];
      return {
        fromText: typeof fromName === "string" ? fromName : null,
        toText: typeof toName === "string" ? toName : null,
      };
    }
    case "file.version_committed": {
      // The committed version's number as text. The PRIOR version's number is not derivable from
      // this row alone (version numbers count every attempt, committed or not), so fromText stays an
      // honest null rather than an arithmetic guess.
      return {
        fromText: null,
        toText: input.versionNumber === null ? null : String(input.versionNumber),
      };
    }
    default:
      return none;
  }
}
