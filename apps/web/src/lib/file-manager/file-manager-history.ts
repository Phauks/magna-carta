/*
 * What this surface can take back, and what it honestly cannot.
 *
 * The steps live here rather than inside the screen for one reason: a step is only worth having if
 * its inverse is exercised, and an inverse written inline in a 2,000-line component is exercised by
 * nobody. Each builder below takes the writes it needs as functions, so a test can hand it counters
 * and assert that undo wrote back exactly what the act wrote — which is the whole claim an undo
 * control makes to a reader.
 *
 * A STEP IS A COMMAND WITH AN INVERSE, NEVER A SNAPSHOT. None of these captures the screen: a move
 * remembers where each key came FROM, a rename remembers the two names, a delete remembers which
 * files went and out of which folder. That is what lets a walk put back exactly what the act
 * changed and leave every other row — and everything somebody else changed meanwhile — alone.
 *
 * A STEP EXISTS ONLY WHERE ITS INVERSE IS REAL. A file's delete is a soft delete with a restore
 * route behind it, so it is steppable. A FOLDER's delete has no restore, so no step is pushed for
 * one and the surface says so out loud instead (`irreversibleAnnouncement`), naming Deleted Files,
 * where the folder's own files can still be reached.
 *
 * A WRITE THAT REFUSES THROWS. The stack answers on the inverse rather than on the pop: a step that
 * throws stays where it was, still offered, and the reader gets another attempt at the same act
 * rather than at the one beneath it.
 */
import type { HistoryStep } from "@magna-carta/design-system/history-stack";
import { countPhrase } from "./file-manager-vocabulary.ts";

/** What one key's move has to remember: the folder it was in before the act. */
export type MoveOrigins = ReadonlyMap<string, string | null>;

/** One file that went, and the folder it went out of, so its restore lands where it was. */
export interface DeletedFileRecord {
  readonly fileId: string;
  readonly folderId: string | null;
}

/**
 * Moving rows between folders — a cut and paste, a drag onto a folder, a folder dragged in the rail.
 *
 * Each key goes back to where IT came from, which is the whole reason the origins are a map: a
 * selection gathered out of three folders and pasted into a fourth cannot be walked back by a
 * single destination.
 */
export function moveStep(input: {
  readonly label: string;
  readonly origins: MoveOrigins;
  readonly destinationFolderId: string | null;
  /** Put one key into one folder. It THROWS when the write refuses. */
  readonly move: (key: string, folderId: string | null) => Promise<void>;
  /** Run once a direction has finished, so the surface re-reads the record exactly once. */
  readonly settled: () => void;
}): HistoryStep {
  return {
    label: input.label,
    undo: async () => {
      for (const [key, origin] of input.origins) await input.move(key, origin);
      input.settled();
    },
    redo: async () => {
      for (const key of input.origins.keys()) await input.move(key, input.destinationFolderId);
      input.settled();
    },
  };
}

/**
 * A deliberate rename. Both names are held, so walking back does not depend on the row still being
 * where it was or on anything else about the screen.
 */
export function renameStep(input: {
  readonly label: string;
  readonly before: string;
  readonly after: string;
  /** Write one name. It THROWS when the write refuses. */
  readonly rename: (name: string) => Promise<void>;
  readonly settled: () => void;
}): HistoryStep {
  return {
    label: input.label,
    undo: async () => {
      await input.rename(input.before);
      input.settled();
    },
    redo: async () => {
      await input.rename(input.after);
      input.settled();
    },
  };
}

/**
 * Deleting files. The inverse is the restore route, told which folder each file came out of — a
 * restore with no destination falls back to the matter root when the old folder has gone, which is
 * the right default for a reader browsing Deleted Files and the wrong one for an undo, where the
 * folder is still there and is where the file belongs.
 */
export function deleteStep(input: {
  readonly label: string;
  readonly removed: readonly DeletedFileRecord[];
  /** Soft-delete one file again. It THROWS when the write refuses. */
  readonly remove: (fileId: string) => Promise<void>;
  /** Bring one file back into a named folder. It THROWS when the write refuses. */
  readonly restore: (fileId: string, folderId: string | null) => Promise<void>;
  readonly settled: () => void;
}): HistoryStep {
  return {
    label: input.label,
    undo: async () => {
      for (const record of input.removed) await input.restore(record.fileId, record.folderId);
      input.settled();
    },
    redo: async () => {
      for (const record of input.removed) await input.remove(record.fileId);
      input.settled();
    },
  };
}

/**
 * Pinning and unpinning. It writes nothing to the record — pinning is the reader's own arrangement
 * of the list — but it is exactly the kind of act a pointer performs by accident over a multiple
 * selection, and its inverse is as real as any other.
 */
export function pinStep(input: {
  readonly label: string;
  readonly keys: readonly string[];
  /** Whether the act PINNED them. Undo does the opposite; redo does it again. */
  readonly pinned: boolean;
  readonly setPinned: (keys: readonly string[], pinned: boolean) => void;
}): HistoryStep {
  return {
    label: input.label,
    undo: () => input.setPinned(input.keys, !input.pinned),
    redo: () => input.setPinned(input.keys, input.pinned),
  };
}

/*
 * The labels. Each completes the sentence "Undo …", so it is the act in lower case with no full
 * stop, and it names what was acted on rather than how many times the reader has pressed something.
 */

export function moveLabel(count: number, destination: string): string {
  return `moving ${countPhrase(count, "item")} to ${destination}`;
}

export function renameLabel(before: string, after: string): string {
  return `renaming ${before} to ${after}`;
}

export function deleteLabel(count: number): string {
  return `deleting ${countPhrase(count, "file")}`;
}

export function pinLabel(count: number, pinned: boolean): string {
  return `${pinned ? "pinning" : "unpinning"} ${countPhrase(count, "item")}`;
}
