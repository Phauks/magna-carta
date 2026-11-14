/*
 * What this surface can actually do, stated once and read by every control that has to be honest
 * about it.
 *
 * The rule this module serves: a capability that is designed but not yet served still RENDERS — the
 * real control, in its real place, disabled, carrying the small "Soon" badge and one line naming
 * what its arrival waits on. Nothing here is omitted and nothing is faked live. A reader sees the
 * shape of what is coming and can never mistake it for working.
 *
 * Each entry was checked against apps/api-worker/src/http/routes/ rather than assumed. Delete an entry
 * the day its route lands and every control that reads it follows.
 */

export interface Capability {
  /** A stable key, so a control asks for one capability without matching on prose. */
  readonly id: string;
  /** What the reader is trying to do, in their words. */
  readonly label: string;
  /** `served` — there is a route and it is called for real. `waiting` — designed, not yet served. */
  readonly reach: "served" | "waiting";
  /** What its arrival waits on. One honest line, shown on the disabled control. */
  readonly waitingOn?: string;
}

const CAPABILITIES: readonly Capability[] = [
  {
    id: "browse",
    label: "Browse the matter's folders and files",
    reach: "served",
  },
  {
    id: "upload",
    label: "Upload a file into a folder",
    reach: "served",
  },
  {
    id: "new-folder",
    label: "Make a folder",
    reach: "served",
  },
  {
    id: "rename",
    label: "Rename a file or folder",
    reach: "served",
  },
  {
    id: "move",
    label: "Move a file or folder",
    reach: "served",
  },
  {
    id: "delete",
    label: "Delete a file or folder",
    reach: "served",
  },
  {
    id: "download",
    label: "Download a file",
    reach: "served",
  },
  {
    id: "download-bundle",
    label: "Download a folder or a selection as one archive",
    reach: "served",
  },
  {
    id: "document-type",
    label: "Set a document type",
    reach: "served",
  },
  {
    id: "versions",
    label: "See a file's versions",
    reach: "served",
  },
  {
    id: "rescan-matter",
    label: "Re-run the safety check across the matter",
    reach: "served",
  },
  {
    id: "rescan-file",
    label: "Re-run the safety check on one file",
    reach: "served",
  },
  {
    id: "copy-paste",
    label: "Copy and paste a file or folder",
    reach: "waiting",
    waitingOn:
      "the server-side copy. Moving works today; copying duplicates bytes and has no route.",
  },
  {
    id: "deleted-files",
    label: "See and restore deleted files",
    reach: "served",
  },
  {
    id: "history",
    label: "The matter's file changelog",
    reach: "served",
  },
  {
    id: "search",
    label: "Search this matter's file names and contents",
    reach: "waiting",
    waitingOn: "the matter search index. Names and contents are both in its scope.",
  },
  {
    id: "archive-browse",
    label: "Browse inside a zip, tar, 7z or rar",
    reach: "served",
  },
  {
    id: "archive-extract",
    label: "Extract an archive's members into the matter",
    reach: "served",
  },
  {
    id: "convert",
    label: "Convert a file to another format",
    reach: "served",
  },
  {
    id: "share",
    label: "Share a file with the client",
    reach: "waiting",
    waitingOn: "client-portal document sharing, which has not started.",
  },
  {
    id: "compare-versions",
    label: "Compare two versions",
    reach: "waiting",
    waitingOn: "the version comparison view.",
  },
  {
    id: "restore-version",
    label: "Restore an older version as a new version",
    reach: "waiting",
    waitingOn:
      "the version-restore route. Nothing is overwritten when it lands: the old version is " +
      "copied forward and every version in between stays.",
  },
  {
    id: "pin-persistence",
    label: "Keep pinned items across visits",
    reach: "waiting",
    waitingOn: "the per-member preference store. Pinning holds for this visit.",
  },
];

const BY_IDENTIFIER = new Map(CAPABILITIES.map((entry) => [entry.id, entry]));

export function capability(id: string): Capability {
  const found = BY_IDENTIFIER.get(id);
  if (found === undefined) {
    throw new Error(`No file-manager capability is registered under "${id}".`);
  }
  return found;
}

export function isServed(id: string): boolean {
  return capability(id).reach === "served";
}

/**
 * The one line a disabled control carries, or undefined when the capability is served. Controls
 * pass this straight to `title`, so the reason is always within reach of the thing it explains.
 */
export function waitingReason(id: string): string | undefined {
  const entry = capability(id);
  return entry.reach === "served" ? undefined : `Waits on ${entry.waitingOn}`;
}

export const FILE_MANAGER_CAPABILITIES = CAPABILITIES;
