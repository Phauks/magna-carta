/*
 * The version history's own decisions, kept out of the inspector so they are unit-testable without a
 * DOM: which rows a folded history shows, how many it folded, what a version's kind is called, and
 * how "who" reads when several members were in the document.
 *
 * EVERY SAVE IS A VERSION, AND THE HISTORY FOLDS. The editor's autosave every few minutes is kept
 * as a version like any other (the owner's ruling: the timeline of every state is the point, and too
 * many rows is a folding problem). So the history shows the named saves by default — the member's
 * own Save, the save as the last view left, the idle reap's cut, and every upload — and folds the
 * autosaves behind one line that says how many, opened with a click. Nothing is dropped.
 */
import type { MatterFileVersion } from "./matter-file-api.ts";

/** Whether a version is one the folded view hides: only the editor's autosaves fold. */
export function isFolded(version: Pick<MatterFileVersion, "saveKind">): boolean {
  return version.saveKind === "autosave";
}

/** The rows a history shows: every version, or the named ones with the autosaves folded away. */
export function versionsToShow(
  versions: readonly MatterFileVersion[],
  showEverySave: boolean,
): readonly MatterFileVersion[] {
  return showEverySave ? versions : versions.filter((version) => !isFolded(version));
}

/** How many versions the folded view is hiding. */
export function foldedCount(versions: readonly MatterFileVersion[]): number {
  return versions.filter(isFolded).length;
}

/** "3 autosaves folded" / "1 autosave folded": the line that opens the fold. */
export function foldedLabel(count: number): string {
  return `${String(count)} ${count === 1 ? "autosave" : "autosaves"} folded`;
}

/** What a version's kind is called in the history's Kind column. */
export function saveKindText(saveKind: MatterFileVersion["saveKind"]): string {
  switch (saveKind) {
    case "explicit":
      return "Saved";
    case "autosave":
      return "Autosaved";
    case "exit":
      return "Saved on close";
    case "reap":
      return "Saved when idle";
    case null:
      return "Added";
  }
}

/**
 * Who a version is by: the member whose save cut it, then everyone else who was in the document —
 * "Ana Vasquez · with Trevor Goldsmith, Mira Chen". A participant whose member row is gone reads as
 * "a former member", never as a blank. A version with no recorded participants reads as its creator.
 */
export function createdByText(
  version: Pick<MatterFileVersion, "uploadedBy" | "uploadedByName" | "participants">,
): string {
  const creator = version.uploadedByName ?? "";
  const others = version.participants
    .filter((participant) => participant.userId !== version.uploadedBy)
    .map((participant) => participant.name ?? "a former member");
  return others.length === 0 ? creator : `${creator} · with ${others.join(", ")}`;
}
